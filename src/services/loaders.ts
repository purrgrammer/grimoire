import {
  createEventLoader,
  createAddressLoader,
  createTimelineLoader,
  createEventLoaderForStore,
} from "applesauce-loaders/loaders";
import type { EventPointer } from "nostr-tools/nip19";
import { Observable } from "rxjs";
import {
  getSeenRelays,
  mergeRelaySets,
  isSafeRelayURL,
} from "applesauce-core/helpers/relays";
import { getOutboxes } from "applesauce-core/helpers/mailboxes";
import {
  getEventPointerFromETag,
  getAddressPointerFromATag,
} from "applesauce-core/helpers/pointers";
import { getTagValue } from "applesauce-core/helpers/event";
import pool from "./relay-pool";
import eventStore from "./event-store";
import { relayListCache } from "./relay-list-cache";
import type { NostrEvent } from "@/types/nostr";

/**
 * A pubkey's NIP-65 write relays, or `[]` when they are not known yet.
 *
 * `relayListCache.getOutboxRelaysSync` reads a 100-entry LRU, and a session
 * that resolves a follow list holds far more than that — 425 kind-10002s
 * against a cache of 100 was measured here, so the entry for any given profile
 * had usually been evicted and every outbox step in this file silently did
 * nothing. The EventStore holds the same events with no cap, so it answers
 * whatever the memory cache has dropped. Dexie is not consulted: it is async,
 * and every caller here is synchronous.
 */
function outboxRelaysFor(pubkey: string): string[] {
  const cached = relayListCache.getOutboxRelaysSync(pubkey);
  if (cached?.length) return cached;

  const relayList = eventStore.getReplaceable(10002, pubkey, "");
  return relayList ? getOutboxes(relayList) : [];
}

/**
 * Extract relay context from a Nostr event for comprehensive relay selection
 * Uses applesauce helpers for robust tag parsing and relay tracking
 */
function extractRelayContext(event: NostrEvent): {
  authorHint?: string;
  seenRelays: Set<string> | undefined;
  rTags: string[];
  eTagRelays: string[];
  aTagRelays: string[];
} {
  // Get relays where this event was seen (tracked by applesauce)
  const seenRelays = getSeenRelays(event);

  // Extract relay URLs from "r" tags (URL references per NIP-01)
  // Only include valid relay URLs (ws:// or wss://) - filter out http/https links
  const rTags = event.tags
    .filter((t) => t[0] === "r")
    .map((t) => t[1])
    .filter(
      (url): url is string => typeof url === "string" && isSafeRelayURL(url),
    );

  // Extract relay hints from all "e" tags using applesauce helper
  // Filter to only valid relay URLs
  const eTagRelays = event.tags
    .filter((t) => t[0] === "e")
    .map((tag) => {
      const pointer = getEventPointerFromETag(tag);
      // v5: returns null for invalid tags instead of throwing
      return pointer?.relays?.[0]; // First relay hint from the pointer
    })
    .filter(
      (url): url is string => typeof url === "string" && isSafeRelayURL(url),
    );

  // Extract relay hints from all "a" tags (addressable event references)
  // This includes both lowercase "a" (reply) and uppercase "A" (root) tags
  // Filter to only valid relay URLs
  const aTagRelays = event.tags
    .filter((t) => t[0] === "a" || t[0] === "A")
    .map((tag) => {
      const pointer = getAddressPointerFromATag(tag);
      return pointer?.relays?.[0]; // First relay hint from the pointer
    })
    .filter(
      (url): url is string => typeof url === "string" && isSafeRelayURL(url),
    );

  // Extract first "p" tag as author hint using applesauce helper
  const authorHint = getTagValue(event, "p");

  return { seenRelays, authorHint, rTags, eTagRelays, aTagRelays };
}

/**
 * General-purpose relays used as a CONTENT fallback: fetching notes when outbox
 * selection came back empty, and adding reach to a publish.
 *
 * Not for discovering where a pubkey publishes — see INDEXER_RELAYS. Those were
 * the same list until a blocked-relay report showed why they must not be: a user
 * blocking spammy content relays is making a statement about content, and when
 * discovery shared the list it took relay-list resolution down with it, leaving
 * a client that could not even load its own contact list.
 *
 * IMPORTANT: URLs must be normalized (trailing slash, lowercase) to match RelayStateManager keys
 */
export const FALLBACK_RELAYS = [
  "wss://nos.lol/",
  "wss://relay.snort.social/",
  "wss://relay.damus.io/",
];

/**
 * Relays used to DISCOVER where a pubkey publishes — kinds 0, 3, 10002 and the
 * other replaceable lists, for pubkeys we hold no relay hint for.
 *
 * Indexers, deliberately, and not the content fallback relays above:
 *
 * - They store little but replaceable events, so resolving a few hundred
 *   kind:10002s is cheap and does not drag a firehose behind it.
 *   `selectRelaysForFilter` gives each list one second; that budget is the
 *   difference between routing by NIP-65 and falling back to them.
 * - They carry no note spam, so the blocklist a spam-weary user actually writes
 *   does not overlap them. Discovery surviving a content blocklist is the whole
 *   point of the split.
 *
 * NOT exempt from the kind-10006 blocked list. Blocking one of these is
 * honoured like any other block; the claim here is only that the DEFAULT
 * discovery set is disjoint from a typical blocklist, not that it is
 * unblockable. When every one of them is blocked, discovery genuinely cannot
 * run, and that has to be reported rather than looking like an empty result.
 *
 * More than one on purpose: asking a single indexer for a follow graph's relay
 * lists both concentrates a privacy leak and makes one operator a single point
 * of failure.
 */
export const INDEXER_RELAYS = [
  "wss://purplepag.es/",
  "wss://user.kindpag.es/",
  "wss://indexer.coracle.social/",
  "wss://relay.vertexlab.io/",
];

// Base event loader (used internally)
const baseEventLoader = createEventLoader(pool, {
  eventStore,
  extraRelays: FALLBACK_RELAYS,
});

/**
 * Smart event loader that combines relay hints with cached relay lists
 *
 * Strategy (priority order):
 * 1. Direct relay hints from EventPointer
 * 2. Seen-at relays (where reply event was received)
 * 3. Author's cached outbox relays (from NIP-65)
 * 4. "a" tag relay hints from context event (addressable references)
 * 5. "r" tags from context event (URL references)
 * 6. Other "e" tag relay hints from context event
 * 7. Fallback relays
 *
 * @param pointer - Event ID or EventPointer with relay hints
 * @param context - Optional context for relay hints:
 *   - string: pubkey of event author (backward compatible)
 *   - NostrEvent: full reply event with r/e/p tags (comprehensive + seen-at relays)
 *
 * Note: This is a synchronous wrapper that uses the memory cache layer only.
 * Full relay list lookup happens async in useOutboxRelays for timelines.
 */
export function eventLoader(
  pointer: EventPointer | { id: string },
  context?: string | NostrEvent,
): Observable<NostrEvent> {
  // Extract context information
  let authorHint: string | undefined;
  let seenRelays: Set<string> | undefined;
  let rTags: string[] = [];
  let eTagRelays: string[] = [];
  let aTagRelays: string[] = [];

  if (context) {
    if (typeof context === "string") {
      // Backward compatible: just an author pubkey
      authorHint = context;
    } else {
      // Comprehensive: extract all relay hints from reply event
      const extracted = extractRelayContext(context);
      authorHint = extracted.authorHint;
      seenRelays = extracted.seenRelays;
      rTags = extracted.rTags;
      eTagRelays = extracted.eTagRelays;
      aTagRelays = extracted.aTagRelays;
    }
  }

  // Get direct relay hints from EventPointer
  const directHints = (pointer as EventPointer).relays || [];

  // Try to get cached outbox relays
  let cachedOutboxRelays: string[] = [];

  // Check if event already exists in store
  const existingEvent = eventStore.getEvent(pointer.id);
  if (existingEvent) {
    cachedOutboxRelays = outboxRelaysFor(existingEvent.pubkey);
  }

  // If not in store but we have author hint (from reply "p" tag)
  if (cachedOutboxRelays.length === 0 && authorHint) {
    cachedOutboxRelays = outboxRelaysFor(authorHint);
  }

  // Limit cached relays to top 3 to avoid too many connections
  const topCachedRelays = cachedOutboxRelays.slice(0, 3);

  // Merge all relay sources with priority ordering
  // mergeRelaySets handles deduplication, normalization, and invalid URL filtering
  const allRelays = mergeRelaySets(
    directHints, // Priority 1: Direct hints (most specific)
    seenRelays, // Priority 2: Where reply was seen (high confidence)
    topCachedRelays, // Priority 3: Author's outbox (NIP-65 standard)
    aTagRelays, // Priority 4: Addressable event references (NIP-22, etc.)
    rTags, // Priority 5: Conversation context
    eTagRelays, // Priority 6: Other event references
    FALLBACK_RELAYS, // Priority 7: Fallback
  );

  // Build enhanced pointer with all relay sources
  const enhancedPointer: EventPointer = {
    id: pointer.id,
    relays: allRelays,
  };

  // Debug logging to track relay sources and deduplication
  const totalSources =
    directHints.length +
    (seenRelays?.size || 0) +
    topCachedRelays.length +
    aTagRelays.length +
    rTags.length +
    eTagRelays.length +
    FALLBACK_RELAYS.length;

  const duplicatesRemoved = totalSources - allRelays.length;

  console.debug(
    `[eventLoader] Fetching ${pointer.id.slice(0, 8)} from ${allRelays.length} relays ` +
      `(direct=${directHints.length} seen=${seenRelays?.size || 0} cached=${topCachedRelays.length} ` +
      `a=${aTagRelays.length} r=${rTags.length} e=${eTagRelays.length} agg=${FALLBACK_RELAYS.length}, ` +
      `${duplicatesRemoved} duplicates removed)`,
  );

  return baseEventLoader(enhancedPointer);
}

/**
 * Address loader for replaceable and addressable events.
 *
 * BOTH sets, indexers first, and the ordering is the whole point.
 * `createAddressLoader` has no outbox step — cache, then pointer relay hints,
 * then `extraRelays`, then lookup relays — so for a pointer carrying no relay
 * hint, `extraRelays` IS the entire relay set. Indexers alone measured zero
 * events for kinds 30023, 30311 and 30777 where a fallback relay returned
 * three, i.e. a hint-less `naddr` for a long-form post, a live activity or a
 * spellbook would simply never resolve.
 *
 * Indexers first still buys what the split was for: kind-10002 discovery
 * resolves from a cheap replaceable-only relay, and it survives a blocklist
 * that covers every content relay.
 */
const baseAddressLoader = createAddressLoader(pool, {
  eventStore,
  extraRelays: [...INDEXER_RELAYS, ...FALLBACK_RELAYS],
});

/**
 * Kinds that ARE how a pubkey's relays are discovered. Routing these by outbox
 * is circular — you would need the relay list to fetch the relay list — so
 * they go to the indexers, which is what indexers are for.
 */
const DISCOVERY_KINDS = new Set([0, 3, 10002]);

/** How many cached outbox relays to add; the same cap `eventLoader` uses. */
const MAX_OUTBOX_RELAYS = 3;

type AddressLoaderArgs = Parameters<typeof baseAddressLoader>;

/**
 * Add the author's NIP-65 write relays to a pointer that carries no hint.
 *
 * `eventLoader` above has done this since it was written; `createAddressLoader`
 * never has. Its order is cache → pointer relay hints → `extraRelays` → lookup
 * relays, so a hint-less pointer is served entirely by `extraRelays` — the
 * indexers plus the content fallback. Neither holds a kind 10063 or 10133, so
 * a user's own Blossom servers and payment targets resolved only when some
 * other subscription happened to drag them into the store.
 *
 * `outboxRelaysFor` is a synchronous lookup, so this costs nothing and is
 * simply skipped when the relay list is not known yet. Nothing about the
 * loader's completion semantics changes — callers waiting on `complete` still
 * see the same stream.
 */
function withOutboxRelays(pointer: AddressLoaderArgs[0]): AddressLoaderArgs[0] {
  if (pointer.relays?.length) return pointer;
  if (DISCOVERY_KINDS.has(pointer.kind)) return pointer;

  const outbox = outboxRelaysFor(pointer.pubkey);
  if (!outbox.length) return pointer;

  return { ...pointer, relays: outbox.slice(0, MAX_OUTBOX_RELAYS) };
}

export function addressLoader(...args: AddressLoaderArgs) {
  const [pointer, ...rest] = args;
  return baseAddressLoader(withOutboxRelays(pointer), ...rest);
}

// Profile loader with batching - combines multiple profile requests within
// 200ms. Kind 0 is a discovery kind, so no outbox step applies.
export const profileLoader = createAddressLoader(pool, {
  eventStore,
  bufferTime: 200, // Batch requests within 200ms window
  extraRelays: [...INDEXER_RELAYS, ...FALLBACK_RELAYS],
});

// Batched address loader for components that fan out over many pointers at
// once. A NKBIP-01 publication index can list 100+ sections; one REQ per
// pointer makes relays rate-limit and the tail never resolves.
const baseBatchedAddressLoader = createAddressLoader(pool, {
  eventStore,
  bufferTime: 200,
  extraRelays: [...INDEXER_RELAYS, ...FALLBACK_RELAYS],
});

export function batchedAddressLoader(...args: AddressLoaderArgs) {
  const [pointer, ...rest] = args;
  return baseBatchedAddressLoader(withOutboxRelays(pointer), ...rest);
}

// Timeline loader factory - creates loader for event feeds
export { createTimelineLoader };

/**
 * Setup unified event loader for automatic missing event loading
 *
 * This attaches a loader to the EventStore that automatically fetches
 * missing events when they're requested via:
 * - eventStore.event({ id: "..." })
 * - eventStore.replaceable({ kind, pubkey, identifier? })
 *
 * The loader handles both single events and replaceable/addressable events
 * through a single interface, with automatic routing based on pointer type.
 *
 * Configuration:
 * - bufferTime: 200ms - batches requests for efficiency
 * - extraRelays: both sets — this loader answers BOTH `event({ id })` and
 *   `replaceable({ kind, pubkey })`, and the two need different relays.
 *   Indexers hold the replaceable lists but not arbitrary events by id;
 *   the fallback relays are the reverse.
 *
 * Note: The custom eventLoader() function above is still available for
 * explicit loading with smart relay hint merging from context events.
 */
createEventLoaderForStore(eventStore, pool, {
  bufferTime: 200,
  extraRelays: [...INDEXER_RELAYS, ...FALLBACK_RELAYS],
});
