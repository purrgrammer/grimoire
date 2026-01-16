/**
 * NIP-17 Adapter - Encrypted Direct Messages via Gift Wraps
 *
 * This adapter provides read-only access to NIP-17 encrypted DMs
 * that have been received and decrypted via gift wraps (NIP-59).
 *
 * Messages are loaded from applesauce WrappedMessagesModel which
 * returns decrypted kind 14 rumors.
 *
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/17.md
 */

import { Observable, map } from "rxjs";
import { nip19 } from "nostr-tools";
import { WrappedMessagesModel } from "applesauce-common/models";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
  Participant,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";

export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /**
   * Parse identifier - accepts npub, nprofile, or hex pubkey
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try nip19 formats
    if (input.startsWith("npub1") || input.startsWith("nprofile1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          return {
            type: "dm-recipient",
            value: decoded.data,
          };
        } else if (decoded.type === "nprofile") {
          return {
            type: "dm-recipient",
            value: decoded.data.pubkey,
            relays: decoded.data.relays,
          };
        }
      } catch {
        return null;
      }
    }

    // Try hex pubkey (64 char hex string)
    if (/^[0-9a-f]{64}$/i.test(input)) {
      return {
        type: "dm-recipient",
        value: input.toLowerCase(),
      };
    }

    return null;
  }

  /**
   * Resolve conversation metadata
   * Returns basic info about the DM conversation
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (identifier.type !== "dm-recipient") {
      throw new Error(
        `NIP-17 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const recipientPubkey = identifier.value;
    const activePubkey = accountManager.active$.value?.pubkey;

    if (!activePubkey) {
      throw new Error("No active account");
    }

    // Get peer participant
    const peerParticipant: Participant = {
      pubkey: recipientPubkey,
    };

    // Get self participant
    const selfParticipant: Participant = {
      pubkey: activePubkey,
    };

    // Create conversation ID (use sorted pubkeys for consistent ID)
    const conversationId = [activePubkey, recipientPubkey].sort().join(":");

    return {
      id: conversationId,
      protocol: this.protocol,
      type: this.type,
      title: `DM with ${recipientPubkey.slice(0, 8)}...`,
      participants: [peerParticipant, selfParticipant],
      unreadCount: 0,
      metadata: {},
    };
  }

  /**
   * Load messages for a conversation
   * Uses WrappedMessagesModel to get decrypted kind 14 messages
   */
  loadMessages(
    conversation: Conversation,
    _options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    const recipientPubkey = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    )?.pubkey;

    if (!recipientPubkey) {
      throw new Error("Recipient pubkey not found in conversation");
    }

    console.log(
      `[NIP-17] Loading messages with ${recipientPubkey} for ${activePubkey}`,
    );

    // WrappedMessagesModel returns ALL decrypted rumors for the user
    // We need to filter for this specific conversation
    return eventStore.model(WrappedMessagesModel, activePubkey).pipe(
      map((rumors) => {
        // rumors is an array of decrypted kind 14 events
        if (!Array.isArray(rumors)) {
          console.warn("[NIP-17] WrappedMessagesModel returned non-array");
          return [];
        }

        // Filter for messages with the specific conversation partner
        const conversationRumors = rumors.filter((rumor) => {
          // Message is in this conversation if:
          // 1. We sent it to the recipient (rumor.pubkey === activePubkey, p-tag === recipientPubkey)
          // 2. Recipient sent it to us (rumor.pubkey === recipientPubkey)
          const pTags = rumor.tags.filter((t) => t[0] === "p");
          const hasRecipient = pTags.some((t) => t[1] === recipientPubkey);

          return (
            (rumor.pubkey === activePubkey && hasRecipient) ||
            rumor.pubkey === recipientPubkey
          );
        });

        console.log(
          `[NIP-17] Got ${conversationRumors.length} messages for conversation (out of ${rumors.length} total)`,
        );

        const messages = conversationRumors.map((rumor) =>
          this.rumorToMessage(rumor, conversation.id),
        );

        // Sort by timestamp (oldest first)
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
    );
  }

  /**
   * Convert a rumor (kind 14) to a Message
   */
  private rumorToMessage(rumor: any, conversationId: string): Message {
    // Extract reply info if present (e-tag referencing previous message)
    const eTags = rumor.tags.filter((t: string[]) => t[0] === "e");
    const replyTo = eTags.length > 0 ? eTags[0][1] : undefined;

    // Create a NostrEvent from rumor (add sig field)
    const event: NostrEvent = {
      ...rumor,
      sig: rumor.sig || "", // Rumors don't have sig
    };

    return {
      id: rumor.id,
      conversationId,
      author: rumor.pubkey,
      content: rumor.content,
      timestamp: rumor.created_at,
      protocol: this.protocol,
      event,
      replyTo,
    };
  }

  /**
   * Load more messages (not applicable for NIP-17)
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    // NIP-17 loads all messages at once, no pagination
    return [];
  }

  /**
   * Load a specific reply message (not implemented for NIP-17)
   */
  async loadReplyMessage(
    _conversation: Conversation,
    _eventId: string,
  ): Promise<NostrEvent | null> {
    // Would need to search through decrypted rumors
    return null;
  }

  /**
   * Send a message (not yet implemented for NIP-17)
   */
  async sendMessage(
    _conversation: Conversation,
    _content: string,
    _options?: SendMessageOptions,
  ): Promise<void> {
    throw new Error("Sending NIP-17 messages is not yet implemented");
  }

  /**
   * React to a message (not supported for NIP-17)
   */
  async reactToMessage(_message: Message, _emoji: string): Promise<NostrEvent> {
    throw new Error("Reactions are not supported for NIP-17");
  }

  /**
   * Delete a message (not supported for NIP-17)
   */
  async deleteMessage(_message: Message): Promise<void> {
    throw new Error("Message deletion is not supported for NIP-17");
  }

  /**
   * List conversations (not yet implemented for NIP-17)
   * This would require scanning all decrypted rumors to find unique conversation partners
   */
  listConversations(): Observable<Conversation[]> {
    throw new Error("Listing NIP-17 conversations is not yet implemented");
  }

  /**
   * Get capabilities - NIP-17 is read-only for now
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true,
      supportsThreading: false,
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      canCreateConversations: false,
      requiresRelay: false,
    };
  }
}
