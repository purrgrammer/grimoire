import { Observable, firstValueFrom, map } from "rxjs";
import { nip19 } from "nostr-tools";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";
import db from "@/services/db";
import { WrappedMessagesModel } from "applesauce-common/models";
import { SendWrappedMessage } from "applesauce-actions/actions";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import { hub } from "@/services/hub";

/**
 * NIP-17 Adapter - Private Direct Messages via Gift Wrap
 *
 * Features:
 * - End-to-end encryption using NIP-44
 * - Sender/receiver anonymity via gift wrap (NIP-59)
 * - Uses kind 10050 (DM relay list) for sending/receiving
 * - Messages are kind 14 (chat message) wrapped as rumors
 *
 * Identifier format: npub/nprofile/hex pubkey of recipient
 */
export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /**
   * Parse identifier - accepts npub, nprofile, or hex pubkey
   * Examples:
   *   - npub1...
   *   - nprofile1...
   *   - hex pubkey (64 chars)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try npub format
    if (input.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          return {
            type: "dm-recipient",
            value: decoded.data,
            relays: [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try nprofile format
    if (input.startsWith("nprofile1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nprofile") {
          return {
            type: "dm-recipient",
            value: decoded.data.pubkey,
            relays: decoded.data.relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try hex pubkey (64 hex chars)
    if (/^[0-9a-f]{64}$/i.test(input)) {
      return {
        type: "dm-recipient",
        value: input.toLowerCase(),
        relays: [],
      };
    }

    return null;
  }

  /**
   * Resolve conversation from recipient identifier
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

    console.log(`[NIP-17] Resolving DM conversation with ${recipientPubkey}`);

    // Fetch recipient's profile for display name
    const profile = await firstValueFrom(
      eventStore.replaceable({ kind: 0, pubkey: recipientPubkey }),
    );

    let title = recipientPubkey.slice(0, 8) + "...";
    if (profile) {
      try {
        const metadata = JSON.parse(profile.content);
        title = metadata.name || metadata.display_name || title;
      } catch {
        // Invalid profile content, use pubkey
      }
    }

    return {
      id: `nip-17:${recipientPubkey}`,
      type: "dm",
      protocol: "nip-17",
      title,
      participants: [{ pubkey: activePubkey }, { pubkey: recipientPubkey }],
      metadata: {
        encrypted: true,
        giftWrapped: true,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a DM conversation
   * Uses WrappedMessagesModel to get decrypted rumors from EventStore
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

        // Sort by timestamp ascending (chat order)
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
    );
  }

  /**
   * Load more historical messages (pagination)
   * For NIP-17, we rely on gift wrap sync to fetch all messages
   * This method returns empty array as pagination is handled by gift wrap manager
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    console.log(
      `[NIP-17] loadMoreMessages called - pagination handled by gift wrap sync`,
    );
    // Gift wrap manager syncs all messages, so we don't need additional fetching
    return [];
  }

  /**
   * Send a message to the recipient
   * Uses SendWrappedMessage action to create and publish gift wrap
   */
  async sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;

    if (!activePubkey) {
      throw new Error("No active account");
    }

    const recipientPubkey = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    )?.pubkey;

    if (!recipientPubkey) {
      throw new Error("Recipient pubkey not found");
    }

    console.log(`[NIP-17] Sending message to ${recipientPubkey}`);

    // Build wrapped message options
    const wrappedOpts: { emojis?: Array<{ shortcode: string; url: string }> } =
      {};

    // Add NIP-30 emoji tags if provided
    if (options?.emojiTags) {
      wrappedOpts.emojis = options.emojiTags.map((e) => ({
        shortcode: e.shortcode,
        url: e.url,
      }));
    }

    // TODO: SendWrappedMessage doesn't currently support reply tags or attachments
    // We may need to use lower-level blueprint API for full feature support
    if (options?.replyTo) {
      console.warn(
        "[NIP-17] Reply tags not yet supported in SendWrappedMessage action",
      );
    }
    if (options?.blobAttachments) {
      console.warn(
        "[NIP-17] Blob attachments not yet supported in SendWrappedMessage action",
      );
    }

    // Use SendWrappedMessage action to wrap and publish
    // It will automatically fetch recipient's inbox relays and send the gift wrap
    await hub.run(SendWrappedMessage, recipientPubkey, content, wrappedOpts);

    console.log(`[NIP-17] Message sent successfully`);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true, // NIP-44 encryption
      supportsThreading: true, // e-tag replies
      supportsModeration: false, // No moderation in DMs
      supportsRoles: false, // No roles in DMs
      supportsGroupManagement: false, // No group management
      canCreateConversations: true, // Can DM any pubkey
      requiresRelay: false, // Uses user's DM relay list
    };
  }

  /**
   * Load a replied-to message by ID
   * First checks EventStore (decrypted rumors), then gift wrap cache
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // Check EventStore for decrypted rumor
    const cachedRumor = await firstValueFrom(eventStore.event(eventId));
    if (cachedRumor) {
      return cachedRumor;
    }

    // Check Dexie cache for decrypted gift wrap by rumor ID
    const decryptedWraps = await db.decryptedGiftWraps
      .where("rumorId")
      .equals(eventId)
      .toArray();

    if (decryptedWraps.length > 0) {
      return decryptedWraps[0].rumor;
    }

    console.warn(`[NIP-17] Reply message ${eventId} not found`);
    return null;
  }

  /**
   * Helper: Convert rumor (kind 14) to Message
   * Rumor is an unsigned event, so we cast it to NostrEvent for storage
   */
  private rumorToMessage(rumor: Rumor, conversationId: string): Message {
    // Extract reply target from e-tags with marker "reply"
    const eTags = rumor.tags.filter((t) => t[0] === "e");
    const replyTag = eTags.find((t) => t[3] === "reply");
    const replyTo = replyTag?.[1];

    return {
      id: rumor.id,
      conversationId,
      author: rumor.pubkey,
      content: rumor.content,
      timestamp: rumor.created_at,
      type: "user",
      replyTo,
      protocol: "nip-17",
      metadata: {
        encrypted: true,
      },
      // Cast Rumor to NostrEvent - it's missing sig field but that's okay for display
      event: rumor as unknown as NostrEvent,
    };
  }
}
