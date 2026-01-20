/**
 * NIP-17 Adapter - Private Direct Messages
 *
 * Features:
 * - End-to-end encrypted direct messages using NIP-44
 * - Gift wrap pattern (NIP-59) for metadata protection
 * - Plausible deniability (unsigned rumor events)
 * - Local storage of decrypted messages
 */

import { Observable, from, map } from "rxjs";
import { nip19, nip44, generateSecretKey, finalizeEvent } from "nostr-tools";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import giftWrapManager from "@/services/gift-wrap";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";
import { publishEventToRelays } from "@/services/hub";
import type { UnsealedDM } from "@/services/db";
import { isNip05, resolveNip05 } from "@/lib/nip05";

/**
 * NIP-17 Adapter - Private Direct Messages
 *
 * Implements NIP-17 (private DMs) using:
 * - NIP-44 encryption
 * - NIP-59 gift wrap pattern
 * - Local storage for decrypted messages
 */
export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /**
   * Parse identifier - accepts $me, NIP-05, npub, nprofile, or hex pubkey
   * Examples:
   *   - $me (DM with yourself)
   *   - alice@example.com (NIP-05 identifier)
   *   - npub1abc... (public key)
   *   - nprofile1xyz... (profile with relay hints)
   *   - 1a2b3c... (hex pubkey)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Handle $me alias (DM with yourself)
    if (input === "$me") {
      const activePubkey = accountManager.active$.value?.pubkey;
      if (!activePubkey) {
        throw new Error("No active account. Log in to use $me.");
      }
      return {
        type: "dm-recipient",
        value: activePubkey,
      };
    }

    // Try NIP-05 format (user@domain.com)
    if (isNip05(input)) {
      return {
        type: "chat-partner-nip05",
        value: input,
      };
    }

    // Try npub format
    if (input.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          return {
            type: "dm-recipient",
            value: decoded.data,
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
            relays: decoded.data.relays,
          };
        }
      } catch {
        return null;
      }
    }

    // Try hex pubkey (64 hex characters)
    if (/^[0-9a-f]{64}$/i.test(input)) {
      return {
        type: "dm-recipient",
        value: input.toLowerCase(),
      };
    }

    return null;
  }

  /**
   * Resolve conversation from DM identifier
   * Handles both direct pubkeys and NIP-05 identifiers
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    let recipientPubkey: string;

    // Resolve NIP-05 identifier to pubkey
    if (identifier.type === "chat-partner-nip05") {
      const resolvedPubkey = await resolveNip05(identifier.value);
      if (!resolvedPubkey) {
        throw new Error(
          `Failed to resolve NIP-05 identifier: ${identifier.value}`,
        );
      }
      recipientPubkey = resolvedPubkey;
    } else if (identifier.type === "dm-recipient") {
      recipientPubkey = identifier.value;
    } else {
      throw new Error(
        `NIP-17 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const activePubkey = accountManager.active$.value?.pubkey;

    if (!activePubkey) {
      throw new Error("No active account");
    }

    // Create conversation key (sorted pubkeys)
    const conversationKey = [activePubkey, recipientPubkey].sort().join(":");

    return {
      id: `nip-17:${conversationKey}`,
      type: "dm",
      protocol: "nip-17",
      title: recipientPubkey.slice(0, 8) + "...", // Will be replaced by profile name
      participants: [{ pubkey: activePubkey }, { pubkey: recipientPubkey }],
      metadata: {
        encrypted: true,
        giftWrapped: true,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a conversation
   * Returns an observable that emits message arrays as they're decrypted
   */
  loadMessages(
    conversation: Conversation,
    _options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const conversationKey = this.getConversationKey(conversation);

    // Return observable from gift wrap manager
    // This will update automatically as new messages are decrypted
    return from(giftWrapManager.getConversationMessages(conversationKey)).pipe(
      map((dms) => dms.map((dm) => this.dmToMessage(dm, conversation.id))),
    );
  }

  /**
   * Load more historical messages (pagination)
   * For NIP-17, all messages are already loaded locally
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    // All messages are already loaded locally from gift wrap manager
    // No additional loading needed
    return [];
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    // Helper to call NIP-44 encrypt (supports both signer patterns)
    const nip44Encrypt = async (
      pubkey: string,
      plaintext: string,
    ): Promise<string> => {
      // Try direct method (PasswordSigner, NostrConnectSigner, etc.)
      if (typeof activeSigner.nip44Encrypt === "function") {
        return await activeSigner.nip44Encrypt(pubkey, plaintext);
      }

      // Try nip44 getter (ExtensionSigner)
      if (
        activeSigner.nip44 &&
        typeof activeSigner.nip44.encrypt === "function"
      ) {
        return await activeSigner.nip44.encrypt(pubkey, plaintext);
      }

      throw new Error("Signer does not support NIP-44 encryption");
    };

    const recipientPubkey = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    )?.pubkey;

    if (!recipientPubkey) {
      throw new Error("Recipient not found in conversation");
    }

    // Get recipient's DM relays (kind 10050)
    const recipientDMRelays = await this.getDMRelays(recipientPubkey);
    const senderDMRelays = await this.getDMRelays(activePubkey);

    // Use recipient's relays, fall back to sender's relays, or use defaults
    const targetRelays =
      recipientDMRelays.length > 0
        ? recipientDMRelays
        : senderDMRelays.length > 0
          ? senderDMRelays
          : ["wss://relay.damus.io"]; // Fallback

    // Step 1: Create the rumor (unsigned kind 14 event)
    const tags: string[][] = [["p", recipientPubkey]];

    if (options?.replyTo) {
      // Use e-tag for replies in NIP-17
      tags.push(["e", options.replyTo]);
    }

    // Add NIP-30 emoji tags
    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    // Add NIP-92 imeta tags for blob attachments
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        tags.push(["imeta", ...imetaParts]);
      }
    }

    const rumor = {
      kind: 14,
      content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: activePubkey,
    };

    // Step 2: Create the seal (kind 13)
    // Encrypt the rumor with conversation key (sender → recipient)
    const rumorJSON = JSON.stringify(rumor);
    const encryptedRumor = await nip44Encrypt(recipientPubkey, rumorJSON);

    // Sign the seal
    const sealDraft = {
      kind: 13,
      content: encryptedRumor,
      tags: [], // No tags on seal
      created_at: this.randomPastTimestamp(),
    };

    const seal = await activeSigner.signEvent(sealDraft);

    // Step 3: Create the gift wrap (kind 1059)
    // Generate ephemeral keypair for gift wrap
    const ephemeralSecretKey = generateSecretKey();

    // Encrypt the seal with ephemeral key → recipient
    const sealJSON = JSON.stringify(seal);
    const conversationKey = nip44.getConversationKey(
      ephemeralSecretKey,
      recipientPubkey,
    );
    const encryptedSeal = nip44.encrypt(sealJSON, conversationKey);

    // Create and sign gift wrap with ephemeral key
    const giftWrapDraft = {
      kind: 1059,
      content: encryptedSeal,
      tags: [["p", recipientPubkey]],
      created_at: this.randomPastTimestamp(),
    };

    const giftWrap = finalizeEvent(giftWrapDraft, ephemeralSecretKey);

    // Publish gift wrap to recipient's relays with error handling
    try {
      await publishEventToRelays(giftWrap, targetRelays);
      console.log(
        `[NIP-17] Sent message to ${recipientPubkey.slice(0, 8)}... via ${targetRelays.length} relays`,
      );
    } catch (error) {
      console.error(
        "[NIP-17] Failed to publish gift wrap to recipient:",
        error,
      );
      throw new Error(
        `Failed to send message: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    // Also send a copy to ourselves (for sent message history)
    // Don't fail the whole operation if this fails
    try {
      const selfConversationKey = nip44.getConversationKey(
        ephemeralSecretKey,
        activePubkey,
      );
      const selfGiftWrapDraft = {
        kind: 1059,
        content: nip44.encrypt(sealJSON, selfConversationKey),
        tags: [["p", activePubkey]],
        created_at: this.randomPastTimestamp(),
      };

      const selfGiftWrap = finalizeEvent(selfGiftWrapDraft, ephemeralSecretKey);
      await publishEventToRelays(selfGiftWrap, senderDMRelays);
    } catch (error) {
      console.warn(
        "[NIP-17] Failed to save copy to own relays (non-fatal):",
        error,
      );
      // Don't throw - message was already sent to recipient
    }
  }

  /**
   * Send a reaction (kind 7) to a message
   * NOTE: Reactions in NIP-17 are not yet standardized
   * This is a placeholder implementation
   */
  async sendReaction(
    _conversation: Conversation,
    _messageId: string,
    _emoji: string,
    _customEmoji?: { shortcode: string; url: string },
  ): Promise<void> {
    throw new Error("Reactions are not yet supported for NIP-17 conversations");
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true, // NIP-44 encryption
      supportsThreading: true, // e-tag replies
      supportsModeration: false, // No moderation in private DMs
      supportsRoles: false, // No roles in 1-on-1 DMs
      supportsGroupManagement: false, // Only 1-on-1 DMs
      canCreateConversations: true, // Can DM any pubkey
      requiresRelay: false, // Uses DM relays or general relays
    };
  }

  /**
   * Load a replied-to message
   */
  async loadReplyMessage(
    conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    const conversationKey = this.getConversationKey(conversation);

    // Search in local unsealed DMs
    const dms = await giftWrapManager.getConversationMessages(conversationKey);
    const dm = dms.find((d) => d.id === eventId);

    if (dm) {
      // Convert DM to NostrEvent-like structure
      return this.dmToEvent(dm);
    }

    // Not found locally
    return null;
  }

  /**
   * Helper: Get conversation key from conversation
   */
  private getConversationKey(conversation: Conversation): string {
    const pubkeys = conversation.participants.map((p) => p.pubkey).sort();
    return pubkeys.join(":");
  }

  /**
   * Helper: Convert UnsealedDM to Message
   */
  private dmToMessage(dm: UnsealedDM, conversationId: string): Message {
    // Look for reply e-tags
    const eTags = dm.tags.filter((t) => t[0] === "e");
    const replyTo = eTags[0]?.[1]; // First e-tag is the reply target

    return {
      id: dm.id,
      conversationId,
      author: dm.senderPubkey,
      content: dm.content,
      timestamp: dm.createdAt,
      type: "user",
      replyTo,
      protocol: "nip-17",
      metadata: {
        encrypted: true,
      },
      event: this.dmToEvent(dm),
    };
  }

  /**
   * Helper: Convert UnsealedDM to NostrEvent-like structure
   */
  private dmToEvent(dm: UnsealedDM): NostrEvent {
    return {
      id: dm.id,
      pubkey: dm.senderPubkey,
      created_at: dm.createdAt,
      kind: dm.kind,
      tags: dm.tags,
      content: dm.content,
      sig: "", // Rumor is unsigned
    };
  }

  /**
   * Helper: Get DM relays from user's kind 10050 event
   */
  private async getDMRelays(pubkey: string): Promise<string[]> {
    // Try to get kind 10050 from event store
    const dmRelayEvent = eventStore.getReplaceable(10050, pubkey, "");

    if (dmRelayEvent) {
      const relays = dmRelayEvent.tags
        .filter((t: string[]) => t[0] === "relay" && t[1])
        .map((t: string[]) => t[1]);

      if (relays.length > 0) {
        return relays;
      }
    }

    return [];
  }

  /**
   * Helper: Generate a random timestamp in the past (up to 2 days ago)
   * Per NIP-17, randomize timestamps to prevent metadata correlation
   */
  private randomPastTimestamp(): number {
    const now = Math.floor(Date.now() / 1000);
    const twoDaysInSeconds = 2 * 24 * 60 * 60;
    const randomOffset = Math.floor(Math.random() * twoDaysInSeconds);
    return now - randomOffset;
  }
}
