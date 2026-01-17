import { Observable, of, firstValueFrom } from "rxjs";
import {
  map,
  filter,
  take,
  timeout,
  toArray,
  catchError,
} from "rxjs/operators";
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
import { hub } from "@/services/hub";
import {
  SendWrappedMessage,
  ReplyToWrappedMessage,
} from "applesauce-actions/actions/wrapped-messages";
import { dmDebug, dmSuccess, dmWarn } from "@/lib/dm-debug";

/** Kind 14: Private direct message (NIP-17) */
const PRIVATE_DM_KIND = 14;

/** Kind 10050: DM relay list (NIP-17) */
const DM_RELAY_LIST_KIND = 10050;

// Note: We rely entirely on eventStore for synthetic event deduplication.
// EventStore.database.getEvent() provides fast O(1) lookup by event ID,
// which is all we need since rumors with the same ID are the same event.

/**
 * Compute a stable conversation ID from sorted participant pubkeys
 */
function computeConversationId(participants: string[]): string {
  const sorted = [...participants].sort();
  return `nip17:${sorted.join(",")}`;
}

/**
 * Fetch inbox relays (kind 10050) for a pubkey.
 * Returns empty array if not found (caller should handle gracefully).
 */
async function fetchInboxRelays(pubkey: string): Promise<string[]> {
  // 1. Check local eventStore first (fast path)
  try {
    const existing = await firstValueFrom(
      eventStore.replaceable(DM_RELAY_LIST_KIND, pubkey).pipe(
        filter((e): e is NostrEvent => e !== undefined),
        take(1),
        timeout(100),
      ),
    );
    if (existing) {
      const relays = parseRelayTags(existing);
      dmDebug(
        "NIP-17",
        `Found cached inbox relays for ${pubkey.slice(0, 8)}: ${relays.length}`,
      );
      return relays;
    }
  } catch {
    // Not in store, continue to network fetch
  }

  // 2. Check if we already have inbox relays cached
  try {
    const cached = await relayListCache.get(pubkey);
    if (cached?.inbox && cached.inbox.length > 0) {
      console.log(
        `[NIP-17] ✅ Using cached inbox relays for ${pubkey.slice(0, 8)}:`,
        cached.inbox.length,
        "relays",
      );
      return cached.inbox;
    }
  } catch {
    // Cache miss, continue to fetch
  }

  // 3. Build relay list to query: participant's outbox + ALL aggregators
  const relaysToQuery: string[] = [];

  try {
    const cached = await relayListCache.get(pubkey);
    if (cached?.write) {
      // Use ALL write relays, not just 3
      relaysToQuery.push(...cached.write);
    }
    if (cached?.read) {
      // Also try read relays as fallback
      relaysToQuery.push(...cached.read);
    }
  } catch {
    // Cache miss
  }

  // Add ALL aggregator relays for maximum coverage
  relaysToQuery.push(...AGGREGATOR_RELAYS);

  // Dedupe
  const uniqueRelays = [...new Set(relaysToQuery)];
  if (uniqueRelays.length === 0) {
    console.warn(
      `[NIP-17] No relays to query for inbox relays of ${pubkey.slice(0, 8)}`,
    );
    return [];
  }

  console.log(
    `[NIP-17] Fetching inbox relays for ${pubkey.slice(0, 8)} from ${uniqueRelays.length} relays (trying harder)`,
  );

  // 4. Fetch from relays with aggressive timeout and retry
  try {
    const events = await firstValueFrom(
      pool
        .request(
          uniqueRelays,
          [{ kinds: [DM_RELAY_LIST_KIND], authors: [pubkey], limit: 1 }],
          { eventStore }, // Events auto-added to EventStore → triggers relay-list-cache
        )
        .pipe(
          toArray(),
          timeout(10000), // Increased to 10s to give more time
          catchError(() => of([] as NostrEvent[])),
        ),
    );

    if (events.length > 0) {
      const latest = events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b,
      );

      // Event is already in EventStore and will be cached by relay-list-cache subscription
      const relays = parseRelayTags(latest);
      console.log(
        `[NIP-17] ✅ Fetched and cached inbox relays for ${pubkey.slice(0, 8)}:`,
        relays.length,
        "relays",
      );
      return relays;
    } else {
      console.warn(
        `[NIP-17] ❌ No inbox relay list (kind ${DM_RELAY_LIST_KIND}) found for ${pubkey.slice(0, 8)} after querying ${uniqueRelays.length} relays`,
      );
    }
  } catch (err) {
    console.error(
      `[NIP-17] ❌ Failed to fetch inbox relays for ${pubkey.slice(0, 8)}:`,
      err,
    );
  }

  return [];
}

/**
 * Parse relay URLs from kind 10050 tags
 */
function parseRelayTags(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === "relay" && tag[1])
    .map((tag) => tag[1]);
}

/**
 * Resolve an identifier to a hex pubkey
 */
async function resolveToPubkey(input: string): Promise<string | null> {
  const trimmed = input.trim();

  // $me alias
  if (trimmed === "$me") {
    return accountManager.active$.value?.pubkey ?? null;
  }

  // npub
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      // Invalid
    }
  }

  // nprofile
  if (trimmed.startsWith("nprofile1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "nprofile") return decoded.data.pubkey;
    } catch {
      // Invalid
    }
  }

  // Hex pubkey
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // NIP-05
  if (trimmed.includes("@") || trimmed.includes(".")) {
    try {
      const pubkey = await resolveNip05(trimmed);
      if (pubkey) return pubkey;
    } catch {
      // Resolution failed
    }
  }

  return null;
}

/**
 * Parse participants from comma-separated identifiers
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
 * Find reply target from e-tags using NIP-10 conventions
 */
function findReplyTarget(tags: string[][]): string | undefined {
  const eTags = tags.filter((tag) => tag[0] === "e" && tag[1]);
  if (eTags.length === 0) return undefined;

  // 1. Explicit "reply" marker
  const replyTag = eTags.find((tag) => tag[3] === "reply");
  if (replyTag) return replyTag[1];

  // 2. Deprecated positional style: last unmarked e-tag
  const unmarkedTags = eTags.filter(
    (tag) => !tag[3] || !["root", "reply", "mention"].includes(tag[3]),
  );
  if (unmarkedTags.length > 0) {
    return unmarkedTags[unmarkedTags.length - 1][1];
  }

  // 3. If only "root" exists, use it
  const rootTag = eTags.find((tag) => tag[3] === "root");
  if (rootTag) return rootTag[1];

  return undefined;
}

/**
 * Get all participants from a rumor (author + p-tag recipients)
 */
function getRumorParticipants(rumor: Rumor): Set<string> {
  const participants = new Set<string>();
  participants.add(rumor.pubkey);

  for (const tag of rumor.tags) {
    if (tag[0] === "p" && tag[1]) {
      participants.add(tag[1]);
    }
  }

  return participants;
}

/**
 * Create a synthetic event from a rumor for display purposes.
 * EventStore handles all deduplication - we just check if it exists first.
 */
function createSyntheticEvent(rumor: Rumor): NostrEvent {
  // Check eventStore first (single source of truth with O(1) lookup)
  const existing = eventStore.database.getEvent(rumor.id);
  if (existing) return existing;

  // Create new synthetic event
  const event: NostrEvent = {
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: rumor.kind,
    tags: rumor.tags,
    content: rumor.content,
    sig: "", // Synthetic - no signature
  };

  // Add to eventStore (it handles deduplication internally)
  eventStore.add(event);

  return event;
}

/**
 * Look up an event by ID - uses eventStore as single source of truth
 */
function lookupEvent(eventId: string): NostrEvent | undefined {
  return eventStore.database.getEvent(eventId);
}

/**
 * Convert a rumor to a Message
 */
function rumorToMessage(conversationId: string, rumor: Rumor): Message {
  const syntheticEvent = createSyntheticEvent(rumor);
  const replyTo = findReplyTarget(rumor.tags);

  return {
    id: rumor.id,
    conversationId,
    author: rumor.pubkey,
    content: rumor.content,
    timestamp: rumor.created_at,
    type: "user",
    replyTo,
    metadata: { encrypted: true },
    protocol: "nip-17",
    event: syntheticEvent,
  };
}

/**
 * NIP-17 Adapter - Private Direct Messages (Gift Wrapped)
 */
export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /**
   * Parse identifier - accepts pubkeys, npubs, nprofiles, NIP-05, $me
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    const trimmed = input.trim();

    // $me alias
    if (trimmed === "$me") {
      return { type: "dm-recipient", value: trimmed, relays: [] };
    }

    // Check for valid pubkey patterns
    const isValid =
      trimmed.startsWith("npub1") ||
      trimmed.startsWith("nprofile1") ||
      /^[0-9a-fA-F]{64}$/.test(trimmed) ||
      trimmed.includes("@") ||
      (trimmed.includes(".") &&
        !trimmed.includes("'") &&
        !trimmed.includes("/"));

    // Or comma-separated list
    const isValidList =
      trimmed.includes(",") &&
      trimmed.split(",").some((p) => {
        const part = p.trim();
        return (
          part === "$me" ||
          part.startsWith("npub1") ||
          part.startsWith("nprofile1") ||
          /^[0-9a-fA-F]{64}$/.test(part) ||
          part.includes("@")
        );
      });

    if (!isValid && !isValidList) return null;

    return { type: "dm-recipient", value: trimmed, relays: [] };
  }

  /**
   * Resolve conversation from identifier
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

    const settings = giftWrapService.settings$.value;
    if (!settings.enabled) {
      throw new Error(
        "Private messages are not enabled. Enable them in the inbox settings.",
      );
    }

    // Parse participants
    const inputPubkeys = await parseParticipants(identifier.value);
    if (inputPubkeys.length === 0) {
      throw new Error(
        `Could not resolve any pubkeys from: ${identifier.value}`,
      );
    }

    // Build participant list (always include self)
    const uniqueParticipants = [
      activePubkey,
      ...inputPubkeys.filter((p) => p !== activePubkey),
    ].filter((p, i, arr) => arr.indexOf(p) === i);

    const conversationId = computeConversationId(uniqueParticipants);
    const isSelfChat = uniqueParticipants.length === 1;
    const isGroup = uniqueParticipants.length > 2;

    // Build title
    let title: string;
    if (isSelfChat) {
      title = "Saved Messages";
    } else if (isGroup) {
      title = `Group (${uniqueParticipants.length})`;
    } else {
      const other = uniqueParticipants.find((p) => p !== activePubkey);
      title = other ? `${other.slice(0, 8)}...` : "Private Chat";
    }

    // Build participants
    const participants: Participant[] = uniqueParticipants.map((pubkey) => ({
      pubkey,
      role: pubkey === activePubkey ? "member" : undefined,
    }));

    // Fetch inbox relays for all participants
    const participantInboxRelays: Record<string, string[]> = {};
    let userInboxRelays: string[] = [];

    // Fetch user's own inbox relays (critical for both sending and receiving)
    // Try cached value first for performance, but fetch if empty to ensure reliability
    const cachedUserRelays = giftWrapService.inboxRelays$.value;
    if (cachedUserRelays.length > 0) {
      // Use cached value if available
      participantInboxRelays[activePubkey] = cachedUserRelays;
      userInboxRelays = cachedUserRelays;
      dmDebug(
        "NIP-17",
        `Using cached inbox relays for ${activePubkey.slice(0, 8)}: ${cachedUserRelays.length} relays`,
      );
    } else {
      // Fetch actively if cache is empty
      const ownRelays = await fetchInboxRelays(activePubkey);
      if (ownRelays.length > 0) {
        participantInboxRelays[activePubkey] = ownRelays;
        userInboxRelays = ownRelays;
        dmDebug(
          "NIP-17",
          `Fetched own inbox relays: ${ownRelays.length} relays`,
        );
      } else {
        dmWarn(
          "NIP-17",
          `Could not find inbox relays for ${activePubkey.slice(0, 8)}`,
        );
      }
    }

    // Fetch for other participants in parallel
    const others = uniqueParticipants.filter((p) => p !== activePubkey);
    if (others.length > 0) {
      const results = await Promise.all(
        others.map(async (pubkey) => ({
          pubkey,
          relays: await fetchInboxRelays(pubkey),
        })),
      );

      for (const { pubkey, relays } of results) {
        if (relays.length > 0) {
          participantInboxRelays[pubkey] = relays;
        }
      }
    }

    // Check if we can reach all participants (for sending messages)
    // Note: We allow conversation creation even without relay lists,
    // since we may already have received messages in our inbox.
    // Sending will be blocked until relay lists are available.
    const unreachable = uniqueParticipants.filter(
      (p) =>
        !participantInboxRelays[p] || participantInboxRelays[p].length === 0,
    );

    // Log warning if relay lists are missing, but don't block conversation
    if (unreachable.length > 0) {
      const unreachableList = unreachable
        .map((p) => p.slice(0, 8) + "...")
        .join(", ");
      dmDebug(
        "NIP-17",
        `Conversation created with missing relay lists (view-only until available): ${unreachableList}`,
      );
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
        inboxRelays: userInboxRelays,
        participantInboxRelays,
        // Flag unreachable participants so UI can show "cannot send" warning
        unreachableParticipants:
          unreachable.length > 0 ? unreachable : undefined,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a conversation.
   * Returns messages sorted chronologically (oldest first).
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
        // Filter rumors belonging to this conversation
        const conversationRumors = rumors.filter(({ rumor }) => {
          if (rumor.kind !== PRIVATE_DM_KIND) return false;

          const rumorParticipants = getRumorParticipants(rumor);
          if (rumorParticipants.size !== participantSet.size) return false;

          for (const p of rumorParticipants) {
            if (!participantSet.has(p)) return false;
          }
          return true;
        });

        // Convert to messages
        const messages = conversationRumors.map(({ rumor }) =>
          rumorToMessage(conversation.id, rumor),
        );

        // Sort chronologically (oldest first) for proper chat display
        messages.sort((a, b) => a.timestamp - b.timestamp);

        return messages;
      }),
    );
  }

  /**
   * Load more historical messages (not implemented - loads all at once)
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    return [];
  }

  /**
   * Send a message to a NIP-17 conversation
   * Uses high-level applesauce actions to build, sign, and publish gift-wrapped messages
   */
  async sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    // 1. Validate active account and signer
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    // 2. Validate inbox relays (CRITICAL: block sending if missing)
    // Note: Conversations can be created without relay lists (to view received messages),
    // but we cannot send until relay lists are available.
    const participantInboxRelays =
      conversation.metadata?.participantInboxRelays || {};
    const participantPubkeys = conversation.participants.map((p) => p.pubkey);
    const unreachableParticipants =
      conversation.metadata?.unreachableParticipants || [];

    // Check unreachableParticipants flag first (faster)
    if (unreachableParticipants.length > 0) {
      const unreachableList = unreachableParticipants
        .map((p) => p.slice(0, 8) + "...")
        .join(", ");
      throw new Error(
        `Cannot send message: The following participants have no inbox relays: ${unreachableList}. ` +
          `They need to publish a kind 10050 DM relay list event to receive encrypted messages.`,
      );
    }

    // Defensive check: verify all participants have inbox relays
    for (const pubkey of participantPubkeys) {
      if (pubkey === activePubkey) continue; // Skip self (we can send to own inbox relays)
      const relays = participantInboxRelays[pubkey];
      if (!relays || relays.length === 0) {
        throw new Error(
          `Cannot send message: Participant ${pubkey.slice(0, 8)}... has no inbox relays. ` +
            `They need to publish a kind 10050 DM relay list event to receive encrypted messages.`,
        );
      }
    }

    // 3. Determine if reply and find parent rumor
    const isReply = !!options?.replyTo;
    let parentRumor: Rumor | undefined;

    if (isReply) {
      const rumors = giftWrapService.decryptedRumors$.value;
      const found = rumors.find(({ rumor }) => rumor.id === options.replyTo);

      if (!found) {
        throw new Error(
          `Cannot reply: Parent message ${options.replyTo!.slice(0, 8)}... not found. ` +
            `It may not have been decrypted yet.`,
        );
      }

      parentRumor = found.rumor;
    }

    // 4. Build action options (emojis, etc.)
    const actionOpts = {
      emojis: options?.emojiTags?.map((e) => ({
        shortcode: e.shortcode,
        url: e.url,
      })),
    };

    // 5. Execute appropriate action via ActionRunner
    try {
      if (isReply && parentRumor) {
        await hub.run(ReplyToWrappedMessage, parentRumor, content, actionOpts);
        dmSuccess("NIP-17", "Reply sent successfully");
      } else {
        // Determine recipients: for self-chat, send to self; for group, filter out self
        // (applesauce automatically adds self for cross-device sync in group messages)
        const others = participantPubkeys.filter((p) => p !== activePubkey);
        const isSelfChat = others.length === 0;

        const recipients = isSelfChat ? [activePubkey] : others;
        await hub.run(SendWrappedMessage, recipients, content, actionOpts);

        dmSuccess(
          "NIP-17",
          `Message sent successfully to ${recipients.length} ${isSelfChat ? "recipient (self)" : "recipients"}`,
        );
      }
    } catch (error) {
      console.error("[NIP-17] Failed to send message:", error);
      throw new Error(
        `Failed to send encrypted message: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true,
      supportsThreading: true,
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      canCreateConversations: false,
      requiresRelay: false,
    };
  }

  /**
   * Load a replied-to message by ID
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // Check our caches first
    const existing = lookupEvent(eventId);
    if (existing) return existing;

    // Check decrypted rumors
    const rumors = giftWrapService.decryptedRumors$.value;
    const found = rumors.find(({ rumor }) => rumor.id === eventId);
    if (found) {
      return createSyntheticEvent(found.rumor);
    }

    return null;
  }

  /**
   * Load conversation list from gift wrap service
   */
  loadConversationList(): Observable<Conversation[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) return of([]);

    return giftWrapService.conversations$.pipe(
      map((conversations) =>
        conversations.map((conv) => ({
          id: conv.id,
          type: "dm" as const,
          protocol: "nip-17" as const,
          title: this.getConversationTitle(conv.participants, activePubkey),
          participants: conv.participants.map((pubkey) => ({ pubkey })),
          metadata: { encrypted: true, giftWrapped: true },
          lastMessage: conv.lastMessage
            ? rumorToMessage(conv.id, conv.lastMessage)
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

    if (others.length === 0) return "Saved Messages";
    if (others.length === 1) return `${others[0].slice(0, 8)}...`;
    return `Group (${participants.length})`;
  }
}
