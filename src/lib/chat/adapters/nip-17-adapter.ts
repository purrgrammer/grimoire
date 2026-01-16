import { Observable, of, firstValueFrom } from "rxjs";
import { map, filter, take, timeout } from "rxjs/operators";
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
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import relayListCache from "@/services/relay-list-cache";

/** Kind 14: Private direct message (NIP-17) */
const PRIVATE_DM_KIND = 14;

/** Kind 10050: DM relay list (NIP-17) */
const DM_RELAY_LIST_KIND = 10050;

/**
 * Compute a stable conversation ID from sorted participant pubkeys
 */
function computeConversationId(participants: string[]): string {
  const sorted = [...participants].sort();
  return `nip17:${sorted.join(",")}`;
}

/**
 * Fetch inbox relays (kind 10050) for a pubkey
 * Strategy:
 * 1. Check local eventStore first
 * 2. Get participant's outbox relays from relay list cache
 * 3. Fetch from their outbox relays + aggregator relays
 */
async function fetchInboxRelays(pubkey: string): Promise<string[]> {
  // First check if we already have the event in the store
  try {
    const existing = await firstValueFrom(
      eventStore.replaceable(DM_RELAY_LIST_KIND, pubkey).pipe(
        filter((e): e is NostrEvent => e !== undefined),
        take(1),
        timeout(100), // Very short timeout since this is just checking local store
      ),
    );

    if (existing) {
      return existing.tags
        .filter((tag) => tag[0] === "relay")
        .map((tag) => tag[1])
        .filter(Boolean);
    }
  } catch {
    // Not in store, try fetching from relays
  }

  // Get participant's outbox relays to query (they should publish their inbox list there)
  let outboxRelays: string[] = [];
  try {
    const cached = await relayListCache.get(pubkey);
    if (cached) {
      outboxRelays = cached.write.slice(0, 3); // Limit to 3 outbox relays
    }
  } catch {
    // Cache miss, will just use aggregators
  }

  // Combine outbox relays with aggregator relays (deduped)
  const relaysToQuery = [
    ...outboxRelays,
    ...AGGREGATOR_RELAYS.slice(0, 2),
  ].filter((url, i, arr) => arr.indexOf(url) === i);

  // Fetch from relays using pool.request
  try {
    const { toArray } = await import("rxjs/operators");
    const events = await firstValueFrom(
      pool
        .request(
          relaysToQuery,
          [{ kinds: [DM_RELAY_LIST_KIND], authors: [pubkey], limit: 1 }],
          { eventStore },
        )
        .pipe(
          toArray(),
          timeout(3000), // 3 second timeout
        ),
    );

    if (events.length > 0) {
      // Get the most recent event
      const latest = events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b,
      );
      return latest.tags
        .filter((tag) => tag[0] === "relay")
        .map((tag) => tag[1])
        .filter(Boolean);
    }
  } catch (err) {
    console.warn(
      `[NIP-17] Failed to fetch inbox relays for ${pubkey.slice(0, 8)}:`,
      err,
    );
  }

  return [];
}

/**
 * Parse participants from a comma-separated list or single identifier
 * Supports: npub, nprofile, hex pubkey (32 bytes), NIP-05, $me
 */
async function parseParticipants(input: string): Promise<string[]> {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const pubkeys: string[] = [];
  const activePubkey = accountManager.active$.value?.pubkey;

  for (const part of parts) {
    // Handle $me alias
    if (part === "$me") {
      if (activePubkey && !pubkeys.includes(activePubkey)) {
        pubkeys.push(activePubkey);
      }
      continue;
    }

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
   * Parse identifier - accepts pubkeys, npubs, nprofiles, NIP-05, $me, or comma-separated list
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Quick check: must look like a pubkey identifier or NIP-05
    const trimmed = input.trim();

    // Check for $me alias (for saved messages)
    if (trimmed === "$me") {
      return {
        type: "dm-recipient",
        value: trimmed,
        relays: [],
      };
    }

    // Check for npub, nprofile, hex, or NIP-05 patterns
    const looksLikePubkey =
      trimmed.startsWith("npub1") ||
      trimmed.startsWith("nprofile1") ||
      /^[0-9a-fA-F]{64}$/.test(trimmed) ||
      trimmed.includes("@") ||
      (trimmed.includes(".") &&
        !trimmed.includes("'") &&
        !trimmed.includes("/"));

    // Also check for comma-separated list (may include $me)
    const looksLikeList =
      trimmed.includes(",") &&
      trimmed
        .split(",")
        .some(
          (p) =>
            p.trim() === "$me" ||
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

    // Fetch inbox relays for all participants in parallel
    const participantInboxRelays: Record<string, string[]> = {};

    // Get current user's relays from service (already loaded)
    const userInboxRelays = giftWrapService.inboxRelays$.value;
    if (userInboxRelays.length > 0) {
      participantInboxRelays[activePubkey] = userInboxRelays;
    }

    // Fetch inbox relays for other participants in parallel
    const otherParticipants = uniqueParticipants.filter(
      (p) => p !== activePubkey,
    );
    if (otherParticipants.length > 0) {
      const relayResults = await Promise.all(
        otherParticipants.map(async (pubkey) => ({
          pubkey,
          relays: await fetchInboxRelays(pubkey),
        })),
      );

      for (const { pubkey, relays } of relayResults) {
        if (relays.length > 0) {
          participantInboxRelays[pubkey] = relays;
        }
      }
    }

    return {
      id: conversationId,
      type: "dm",
      protocol: "nip-17",
      title,
      participants,
      metadata: {
        encrypted: true,
        giftWrapped: true,
        // Store inbox relays for display in header
        inboxRelays: userInboxRelays,
        participantInboxRelays,
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
   * Find the reply target from e-tags using NIP-10 conventions
   *
   * NIP-10 marker priority:
   * 1. Tag with "reply" marker - this is the direct parent
   * 2. If only "root" marker exists and no other e-tags - use root as reply target
   * 3. Deprecated: last e-tag without markers
   */
  private findReplyTarget(tags: string[][]): string | undefined {
    const eTags = tags.filter((tag) => tag[0] === "e" && tag[1]);

    if (eTags.length === 0) return undefined;

    // Check for explicit "reply" marker
    const replyTag = eTags.find((tag) => tag[3] === "reply");
    if (replyTag) {
      return replyTag[1];
    }

    // Check for "root" marker (if it's the only e-tag or no other is marked as reply)
    const rootTag = eTags.find((tag) => tag[3] === "root");

    // Check for unmarked e-tags (deprecated positional style)
    const unmarkedTags = eTags.filter(
      (tag) =>
        !tag[3] ||
        (tag[3] !== "root" && tag[3] !== "reply" && tag[3] !== "mention"),
    );

    // If there are unmarked tags, use the last one as reply (deprecated style)
    if (unmarkedTags.length > 0) {
      return unmarkedTags[unmarkedTags.length - 1][1];
    }

    // If only root exists, it's both root and reply target
    if (rootTag) {
      return rootTag[1];
    }

    // Fallback: last e-tag that isn't a mention
    const nonMentionTags = eTags.filter((tag) => tag[3] !== "mention");
    if (nonMentionTags.length > 0) {
      return nonMentionTags[nonMentionTags.length - 1][1];
    }

    return undefined;
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
   * Creates a synthetic event from the rumor for display purposes
   */
  private rumorToMessage(
    conversationId: string,
    _giftWrap: NostrEvent,
    rumor: Rumor,
  ): Message {
    // Find reply-to from e tags using NIP-10 marker convention
    // Markers: "reply" = direct parent, "root" = thread root, "mention" = just a mention
    // Format: ["e", <event-id>, <relay-hint>, <marker>]
    const replyTo = this.findReplyTarget(rumor.tags);

    // Create a synthetic event from the rumor for display
    // This allows RichText to parse content correctly
    const syntheticEvent: NostrEvent = {
      id: rumor.id,
      pubkey: rumor.pubkey,
      created_at: rumor.created_at,
      kind: rumor.kind,
      tags: rumor.tags,
      content: rumor.content,
      sig: "", // Empty sig - this is a display-only synthetic event
    };

    // Add to eventStore so ReplyPreview can find it by rumor ID
    eventStore.add(syntheticEvent);

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
      // Use synthetic event with decrypted content
      event: syntheticEvent,
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
   * Load a replied-to message by ID (rumor ID)
   * Creates a synthetic event from the rumor if found
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // First check if it's already in eventStore (synthetic event may have been added)
    const existingEvent = eventStore.database.getEvent(eventId);
    if (existingEvent) {
      return existingEvent;
    }

    // Check decrypted rumors for the message
    const rumors = giftWrapService.decryptedRumors$.value;
    const found = rumors.find(({ rumor }) => rumor.id === eventId);
    if (found) {
      // Create and add synthetic event from rumor
      const syntheticEvent: NostrEvent = {
        id: found.rumor.id,
        pubkey: found.rumor.pubkey,
        created_at: found.rumor.created_at,
        kind: found.rumor.kind,
        tags: found.rumor.tags,
        content: found.rumor.content,
        sig: "",
      };
      eventStore.add(syntheticEvent);
      return syntheticEvent;
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
