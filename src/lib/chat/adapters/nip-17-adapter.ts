/**
 * NIP-17 Adapter - Encrypted Direct Messages via Gift Wraps
 *
 * This adapter provides read-only access to NIP-17 encrypted DMs
 * that have been received and decrypted via gift wraps (NIP-59).
 *
 * Messages are loaded from the local decryptedRumors database table,
 * which is populated by the gift-wrap-loader service.
 *
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/17.md
 */

import { Observable } from "rxjs";
import { nip19 } from "nostr-tools";
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
import db from "@/services/db";
import eventStore from "@/services/event-store";

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
      throw new Error("Invalid identifier type for NIP-17");
    }

    const peerPubkey = identifier.value;

    // Get active account pubkey
    const activePubkey = await this.getActivePubkey();

    // Try to get conversation metadata from database
    const conversationId = `${peerPubkey}:${activePubkey}`;
    const conversation = await db.conversations.get(conversationId);

    // Get profile from eventStore
    const profile = eventStore.getReplaceable(0, peerPubkey, "");

    // Get peer participant
    const peerParticipant: Participant = {
      pubkey: peerPubkey,
    };

    // Get self participant
    const selfParticipant: Participant = {
      pubkey: activePubkey,
    };

    return {
      id: conversationId,
      type: "dm",
      protocol: "nip-17",
      title: profile?.content
        ? JSON.parse(profile.content).name || peerPubkey.slice(0, 8)
        : peerPubkey.slice(0, 8),
      participants: [peerParticipant, selfParticipant],
      unreadCount: conversation?.unreadCount ?? 0,
      metadata: {
        encrypted: true,
        giftWrapped: true,
      },
    };
  }

  /**
   * Load messages from decryptedRumors table
   * Returns an Observable with all messages for this conversation
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    // Parse peer pubkey from conversation ID
    const [peerPubkey] = conversation.id.split(":");

    // Get messages from database (async)
    const messagesPromise = this.loadMessagesFromDb(
      peerPubkey,
      conversation.id,
      options?.limit ?? 100,
    );

    // Convert promise to observable
    return new Observable((subscriber) => {
      messagesPromise
        .then((messages) => {
          subscriber.next(messages);
          subscriber.complete();
        })
        .catch((err) => subscriber.error(err));
    });
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const [peerPubkey] = conversation.id.split(":");
    return this.loadMessagesFromDb(peerPubkey, conversation.id, 50, before);
  }

  /**
   * Load messages from database
   */
  private async loadMessagesFromDb(
    peerPubkey: string,
    conversationId: string,
    limit: number,
    before?: number,
  ): Promise<Message[]> {
    const activePubkey = await this.getActivePubkey();

    // Query decryptedRumors table for messages with this peer
    let receivedQuery = db.decryptedRumors
      .where("[recipientPubkey+senderPubkey]")
      .equals([activePubkey, peerPubkey]);

    if (before) {
      receivedQuery = receivedQuery.filter((r) => r.rumorCreatedAt < before);
    }

    const rumors = await receivedQuery.reverse().limit(limit).toArray();

    // Also get messages I sent to them (if any)
    let sentQuery = db.decryptedRumors
      .where("[recipientPubkey+senderPubkey]")
      .equals([peerPubkey, activePubkey]);

    if (before) {
      sentQuery = sentQuery.filter((r) => r.rumorCreatedAt < before);
    }

    const sentRumors = await sentQuery.reverse().limit(limit).toArray();

    // Combine and sort by timestamp
    const allRumors = [...rumors, ...sentRumors].sort(
      (a, b) => a.rumorCreatedAt - b.rumorCreatedAt,
    );

    // Convert to Message format
    return allRumors
      .filter((r) => r.rumorKind === 14) // Only chat messages (kind 14)
      .map((r) => ({
        id: r.giftWrapId,
        conversationId,
        author: r.senderPubkey,
        content: r.rumor.content,
        timestamp: r.rumorCreatedAt,
        protocol: "nip-17" as const,
        event: r.rumor,
      }));
  }

  /**
   * Send message - NOT IMPLEMENTED (read-only for now)
   */
  async sendMessage(
    _conversation: Conversation,
    _content: string,
    _options?: SendMessageOptions,
  ): Promise<void> {
    throw new Error(
      "Sending NIP-17 messages is not yet implemented. This adapter is read-only.",
    );
  }

  /**
   * Get capabilities - read-only for now
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true, // NIP-17 is encrypted
      supportsThreading: false, // DMs don't have threading
      supportsModeration: false, // No moderation in DMs
      supportsRoles: false, // No roles in 1-on-1 DMs
      supportsGroupManagement: false, // Not a group
      canCreateConversations: false, // Read-only for now
      requiresRelay: false, // Uses DM relay lists, not specific relay
    };
  }

  /**
   * Load reply message - not implemented for NIP-17
   */
  async loadReplyMessage(
    _conversation: Conversation,
    _eventId: string,
  ): Promise<NostrEvent | null> {
    return null;
  }

  /**
   * Get active pubkey from account manager
   */
  private async getActivePubkey(): Promise<string> {
    // Import dynamically to avoid circular dependency
    const { default: accountManager } = await import("@/services/accounts");
    const account = accountManager.active;
    if (!account) {
      throw new Error("No active account");
    }
    return account.pubkey;
  }
}
