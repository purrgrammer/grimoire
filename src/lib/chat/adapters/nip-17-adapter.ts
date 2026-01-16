import { Observable, of } from "rxjs";
import { map } from "rxjs/operators";
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
import giftWrapService, { type Rumor } from "@/services/gift-wrap";
import accountManager from "@/services/accounts";
import { resolveNip05 } from "@/lib/nip05";

/** Kind 14: Private direct message (NIP-17) */
const PRIVATE_DM_KIND = 14;

/**
 * Compute a stable conversation ID from sorted participant pubkeys
 */
function computeConversationId(participants: string[]): string {
  const sorted = [...participants].sort();
  return `nip17:${sorted.join(",")}`;
}

/**
 * Parse participants from a comma-separated list or single identifier
 * Supports: npub, nprofile, hex pubkey (32 bytes), NIP-05
 */
async function parseParticipants(input: string): Promise<string[]> {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const pubkeys: string[] = [];

  for (const part of parts) {
    const pubkey = await resolveToPubkey(part);
    if (pubkey && !pubkeys.includes(pubkey)) {
      pubkeys.push(pubkey);
    }
  }

  return pubkeys;
}

/**
 * Resolve an identifier to a hex pubkey
 */
async function resolveToPubkey(input: string): Promise<string | null> {
  // Try npub
  if (input.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "npub") {
        return decoded.data;
      }
    } catch {
      // Not a valid npub
    }
  }

  // Try nprofile
  if (input.startsWith("nprofile1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "nprofile") {
        return decoded.data.pubkey;
      }
    } catch {
      // Not a valid nprofile
    }
  }

  // Try hex pubkey (64 chars)
  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    return input.toLowerCase();
  }

  // Try NIP-05 (contains @ or is bare domain)
  if (input.includes("@") || input.includes(".")) {
    try {
      const pubkey = await resolveNip05(input);
      if (pubkey) {
        return pubkey;
      }
    } catch {
      // NIP-05 resolution failed
    }
  }

  return null;
}

/**
 * NIP-17 Adapter - Private Direct Messages (Gift Wrapped)
 *
 * Features:
 * - End-to-end encrypted messages via NIP-59 gift wraps
 * - 1-on-1 conversations
 * - Group conversations (multiple recipients)
 * - Self-messages ("saved messages")
 * - Read-only for now (sending messages coming later)
 *
 * Identifier formats:
 * - npub1... (single recipient)
 * - nprofile1... (single recipient with relay hints)
 * - hex pubkey (64 chars)
 * - NIP-05 address (user@domain.com or _@domain.com)
 * - Comma-separated list of any of the above for groups
 */
export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /**
   * Parse identifier - accepts pubkeys, npubs, nprofiles, NIP-05, or comma-separated list
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Quick check: must look like a pubkey identifier or NIP-05
    const trimmed = input.trim();

    // Check for npub, nprofile, hex, or NIP-05 patterns
    const looksLikePubkey =
      trimmed.startsWith("npub1") ||
      trimmed.startsWith("nprofile1") ||
      /^[0-9a-fA-F]{64}$/.test(trimmed) ||
      trimmed.includes("@") ||
      (trimmed.includes(".") &&
        !trimmed.includes("'") &&
        !trimmed.includes("/"));

    // Also check for comma-separated list
    const looksLikeList =
      trimmed.includes(",") &&
      trimmed
        .split(",")
        .some(
          (p) =>
            p.trim().startsWith("npub1") ||
            p.trim().startsWith("nprofile1") ||
            /^[0-9a-fA-F]{64}$/.test(p.trim()) ||
            p.trim().includes("@"),
        );

    if (!looksLikePubkey && !looksLikeList) {
      return null;
    }

    // Return a placeholder identifier - actual resolution happens in resolveConversation
    return {
      type: "dm-recipient",
      value: trimmed, // Will be resolved later
      relays: [],
    };
  }

  /**
   * Resolve conversation from DM identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (
      identifier.type !== "dm-recipient" &&
      identifier.type !== "chat-partner"
    ) {
      throw new Error(
        `NIP-17 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    // Check if private messages are enabled
    const settings = giftWrapService.settings$.value;
    if (!settings.enabled) {
      throw new Error(
        "Private messages are not enabled. Enable them in the inbox settings.",
      );
    }

    // Parse the identifier to get participant pubkeys
    const inputPubkeys = await parseParticipants(identifier.value);
    if (inputPubkeys.length === 0) {
      throw new Error(
        `Could not resolve any pubkeys from: ${identifier.value}`,
      );
    }

    // Build full participant list (always include self)
    const allParticipants = [
      activePubkey,
      ...inputPubkeys.filter((p) => p !== activePubkey),
    ];
    const uniqueParticipants = [...new Set(allParticipants)];

    // Determine conversation type
    const isSelfChat = uniqueParticipants.length === 1; // Only self
    const isGroup = uniqueParticipants.length > 2; // More than 2 people

    // Create conversation ID from participants
    const conversationId = computeConversationId(uniqueParticipants);

    // Build title
    let title: string;
    if (isSelfChat) {
      title = "Saved Messages";
    } else if (isGroup) {
      title = `Group (${uniqueParticipants.length})`;
    } else {
      // 1-on-1: use the other person's pubkey for title
      const otherPubkey = uniqueParticipants.find((p) => p !== activePubkey);
      title = otherPubkey ? `${otherPubkey.slice(0, 8)}...` : "Private Chat";
    }

    // Build participants array
    const participants: Participant[] = uniqueParticipants.map((pubkey) => ({
      pubkey,
      role: pubkey === activePubkey ? "member" : undefined,
    }));

    return {
      id: conversationId,
      type: "dm",
      protocol: "nip-17",
      title,
      participants,
      metadata: {
        encrypted: true,
        giftWrapped: true,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a conversation
   * Filters decrypted rumors to match conversation participants
   */
  loadMessages(
    conversation: Conversation,
    _options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const participantSet = new Set(
      conversation.participants.map((p) => p.pubkey),
    );

    return giftWrapService.decryptedRumors$.pipe(
      map((rumors) => {
        // Filter rumors that belong to this conversation
        const conversationRumors = rumors.filter(({ rumor }) => {
          // Only include kind 14 (private DMs)
          if (rumor.kind !== PRIVATE_DM_KIND) return false;

          // Get all participants from the rumor
          const rumorParticipants = this.getRumorParticipants(rumor);

          // Check if participants match (same set of pubkeys)
          if (rumorParticipants.size !== participantSet.size) return false;
          for (const p of rumorParticipants) {
            if (!participantSet.has(p)) return false;
          }
          return true;
        });

        // Convert to Message format
        return conversationRumors.map(({ giftWrap, rumor }) =>
          this.rumorToMessage(conversation.id, giftWrap, rumor),
        );
      }),
    );
  }

  /**
   * Get all participants from a rumor (author + all p-tag recipients)
   */
  private getRumorParticipants(rumor: Rumor): Set<string> {
    const participants = new Set<string>();
    participants.add(rumor.pubkey); // Author

    // Add all p-tag recipients
    for (const tag of rumor.tags) {
      if (tag[0] === "p" && tag[1]) {
        participants.add(tag[1]);
      }
    }

    return participants;
  }

  /**
   * Convert a rumor to a Message
   */
  private rumorToMessage(
    conversationId: string,
    giftWrap: NostrEvent,
    rumor: Rumor,
  ): Message {
    // Find reply-to from e tags
    let replyTo: string | undefined;
    for (const tag of rumor.tags) {
      if (tag[0] === "e" && tag[1]) {
        // NIP-10: last e tag is usually the reply target
        replyTo = tag[1];
      }
    }

    return {
      id: rumor.id,
      conversationId,
      author: rumor.pubkey,
      content: rumor.content,
      timestamp: rumor.created_at,
      type: "user",
      replyTo,
      metadata: {
        encrypted: true,
      },
      protocol: "nip-17",
      // Use gift wrap as the event since rumor is unsigned
      event: giftWrap,
    };
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    // For now, all messages are loaded at once from the gift wrap service
    // Pagination would require fetching more gift wraps from relays
    return [];
  }

  /**
   * Send a message (not implemented yet - read-only for now)
   */
  async sendMessage(
    _conversation: Conversation,
    _content: string,
    _options?: SendMessageOptions,
  ): Promise<void> {
    throw new Error(
      "Sending messages is not yet implemented for NIP-17. Coming soon!",
    );
  }

  /**
   * Get capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true,
      supportsThreading: true, // via e tags
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      canCreateConversations: false, // read-only for now
      requiresRelay: false, // uses inbox relays from profile
    };
  }

  /**
   * Load a replied-to message by ID
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // Check decrypted rumors for the message
    const rumors = giftWrapService.decryptedRumors$.value;
    const found = rumors.find(({ rumor }) => rumor.id === eventId);
    if (found) {
      // Return the gift wrap event
      return found.giftWrap;
    }
    return null;
  }

  /**
   * Load conversation list from gift wrap service
   */
  loadConversationList(): Observable<Conversation[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      return of([]);
    }

    return giftWrapService.conversations$.pipe(
      map((conversations) =>
        conversations.map((conv) => ({
          id: conv.id,
          type: "dm" as const,
          protocol: "nip-17" as const,
          title: this.getConversationTitle(conv.participants, activePubkey),
          participants: conv.participants.map((pubkey) => ({ pubkey })),
          metadata: {
            encrypted: true,
            giftWrapped: true,
          },
          lastMessage: conv.lastMessage
            ? this.rumorToMessage(conv.id, conv.lastGiftWrap!, conv.lastMessage)
            : undefined,
          unreadCount: 0,
        })),
      ),
    );
  }

  /**
   * Get conversation title from participants
   */
  private getConversationTitle(
    participants: string[],
    activePubkey: string,
  ): string {
    const others = participants.filter((p) => p !== activePubkey);

    if (others.length === 0) {
      return "Saved Messages";
    } else if (others.length === 1) {
      return `${others[0].slice(0, 8)}...`;
    } else {
      return `Group (${participants.length})`;
    }
  }
}
