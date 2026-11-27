import {
  createEventLoader,
  createAddressLoader,
  createTimelineLoader,
  createEventLoaderForStore,
} from "applesauce-loaders/loaders";
import type { EventPointer } from "nostr-tools/nip19";
import {
  Observable,
  EMPTY,
  defer,
  forkJoin,
  from,
  merge,
  of,
  catchError,
  concatWith,
  ignoreElements,
  switchMap,
  timeout,
} from "rxjs";
import {
  getSeenRelays,
  mergeRelaySets,
  isSafeRelayURL,
} from "applesauce-core/helpers/relays";
import { getOutboxes } from "applesauce-core/helpers/mailboxes";
import {
  getEventPointerFromETag,
  getEventPointerFromQTag,
  getAddressPointerFromATag,
  getProfilePointerFromPTag,
} from "applesauce-core/helpers/pointers";
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

/** How many outbox relays to add per author, in both loaders. */
const MAX_OUTBOX_RELAYS = 3;

/**
 * Extract relay context from a Nostr event for comprehensive relay selection
 * Uses applesauce helpers for robust tag parsing and relay tracking
 */
function extractRelayContext(event: NostrEvent): {
  authorHints: string[];
  seenRelays: Set<string> | undefined;
  rTags: string[];
  eTagRelays: string[];
  qTagRelays: string[];
  aTagRelays: string[];
  pTagRelays: string[];
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

  // Extract relay hints from all "q" tags (NIP-18 quote references).
  // A quote's hint is often the ONLY hint an event carries for the quoted
  // note — clients that write a `q` tag frequently omit the hint from the
  // inline `nostr:nevent`, or write a bare `note1`.
  const qTagRelays = event.tags
    .filter((t) => t[0] === "q")
    .map((tag) => getEventPointerFromQTag(tag)?.relays?.[0])
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

  // Author candidates from "p" tags — FIRST AND LAST, not just the first.
  // NIP-25 puts the reacted event's author in the LAST "p" tag, and clients
  // that copy the thread's participants in front of it (Damus-style) leave a
  // stranger in the first slot. Looking up the wrong person's outbox is how a
  // reaction ends up routed to relays that never held the note. The two
  // collapse to one candidate on the common single-"p" event.
  const pTags = event.tags.filter(
    (t) => t[0] === "p" && typeof t[1] === "string" && t[1].length > 0,
  );
  const edgePTags =
    pTags.length > 1 ? [pTags[0], pTags[pTags.length - 1]] : pTags;
  const authorHints = Array.from(new Set(edgePTags.map((t) => t[1])));

  // Relay hints carried by those same "p" tags. Only the edge tags, unlike the
  // e/r/q hints above: a "p" hint locates a PERSON rather than the event we
  // want, and every relay merged in becomes a socket — a note with twenty
  // mentions would open twenty connections for no gain.
  const pTagRelays = edgePTags
    .map((tag) => getProfilePointerFromPTag(tag)?.relays?.[0])
    .filter(
      (url): url is string => typeof url === "string" && isSafeRelayURL(url),
    );

  return {
    seenRelays,
    authorHints,
    rTags,
    eTagRelays,
    qTagRelays,
    aTagRelays,
    pTagRelays,
  };
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
/**
 * Set ONLY by end-to-end test builds (scripts/android-e2e/README.md): every
 * discovery and fallback read goes to one local fixture relay, so a test run
 * can resolve its throwaway account's relay and Blossom lists without asking,
 * or publishing to, any public relay. Unset in every real build.
 */
const E2E_RELAY = (import.meta.env.VITE_E2E_RELAY as string | undefined)
  ?.trim()
  .replace(/\/?$/, "/");

export const FALLBACK_RELAYS = E2E_RELAY
  ? [E2E_RELAY]
  : ["wss://nos.lol/", "wss://relay.snort.social/", "wss://relay.damus.io/"];

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
export const INDEXER_RELAYS = E2E_RELAY
  ? [E2E_RELAY]
  : [
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
 * 3. Author outbox relays (NIP-65), MERGED across every author the context
 *    names — the stored event's pubkey, the pointer's own `author`, and the
 *    context's first and last "p" tags — not the first one that answers.
 *    A reaction is the case that forced this: its "e" tag often carries no
 *    hint at all, so the "p" tag's outbox is the only routing that exists,
 *    and where a hint IS present it is a single relay with no backup.
 * 4. "p" tag relay hints from context event (where to find the author)
 * 5. "a" tag relay hints from context event (addressable references)
 * 6. "q" tag relay hints from context event (quote references)
 * 7. "r" tags from context event (URL references)
 * 8. Other "e" tag relay hints from context event
 * 9. Fallback relays
 *
 * @param pointer - Event ID or EventPointer with relay hints
 * @param context - Optional context for relay hints:
 *   - string: pubkey of event author (backward compatible)
 *   - NostrEvent: full reply event with q/r/e/p tags (comprehensive + seen-at relays)
 *
 * Note: This is a synchronous wrapper that uses the memory cache layer only.
 * Full relay list lookup happens async in useOutboxRelays for timelines.
 */
export function eventLoader(
  pointer: EventPointer | { id: string },
  context?: string | NostrEvent,
): Observable<NostrEvent> {
  // Extract context information
  let authorHints: string[] = [];
  let seenRelays: Set<string> | undefined;
  let rTags: string[] = [];
  let eTagRelays: string[] = [];
  let qTagRelays: string[] = [];
  let aTagRelays: string[] = [];
  let pTagRelays: string[] = [];

  if (context) {
    if (typeof context === "string") {
      // Backward compatible: just an author pubkey
      authorHints = [context];
    } else {
      // Comprehensive: extract all relay hints from reply event
      const extracted = extractRelayContext(context);
      authorHints = extracted.authorHints;
      seenRelays = extracted.seenRelays;
      rTags = extracted.rTags;
      eTagRelays = extracted.eTagRelays;
      qTagRelays = extracted.qTagRelays;
      aTagRelays = extracted.aTagRelays;
      pTagRelays = extracted.pTagRelays;
    }
  }

  // Get direct relay hints from EventPointer
  const directHints = (pointer as EventPointer).relays || [];

  // Every author the caller can name, most authoritative first: the event
  // itself if we already hold it, then the pointer's own `author` (an `nevent`
  // carries it; a bare `note1` does not), then the context's "p" tags.
  //
  // MERGED, not first-answer-wins. A source answering with SOME relays used to
  // end the search, which quietly discarded the others — and for a reaction the
  // "p" tag is frequently the only routing that exists, so losing it to a
  // pointer author whose relay list happens to be cached means the note is
  // looked for on the fallback relays alone.
  const existingEvent = eventStore.getEvent(pointer.id);

  const authorCandidates = Array.from(
    new Set(
      [
        existingEvent?.pubkey,
        (pointer as EventPointer).author,
        ...authorHints,
      ].filter((pubkey): pubkey is string => !!pubkey),
    ),
  );

  // Capped per author, not in total: two authors are worth two relay lists,
  // and the candidate list is four entries at the very most (stored pubkey,
  // pointer author, first and last "p" tag) with duplicates already removed.
  const topCachedRelays = mergeRelaySets(
    ...authorCandidates.map((pubkey) =>
      outboxRelaysFor(pubkey).slice(0, MAX_OUTBOX_RELAYS),
    ),
  );

  // Merge all relay sources with priority ordering
  // mergeRelaySets handles deduplication, normalization, and invalid URL filtering
  const allRelays = mergeRelaySets(
    directHints, // Priority 1: Direct hints (most specific)
    seenRelays, // Priority 2: Where reply was seen (high confidence)
    topCachedRelays, // Priority 3: Author outboxes (NIP-65 standard)
    pTagRelays, // Priority 4: Author hints from "p" tags
    aTagRelays, // Priority 5: Addressable event references (NIP-22, etc.)
    qTagRelays, // Priority 6: Quote references (NIP-18)
    rTags, // Priority 7: Conversation context
    eTagRelays, // Priority 8: Other event references
    FALLBACK_RELAYS, // Priority 9: Fallback
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
    pTagRelays.length +
    aTagRelays.length +
    qTagRelays.length +
    rTags.length +
    eTagRelays.length +
    FALLBACK_RELAYS.length;

  const duplicatesRemoved = totalSources - allRelays.length;

  console.debug(
    `[eventLoader] Fetching ${pointer.id.slice(0, 8)} from ${allRelays.length} relays ` +
      `(direct=${directHints.length} seen=${seenRelays?.size || 0} cached=${topCachedRelays.length} ` +
      `p=${pTagRelays.length} a=${aTagRelays.length} q=${qTagRelays.length} ` +
      `r=${rTags.length} e=${eTagRelays.length} ` +
      `agg=${FALLBACK_RELAYS.length}, ` +
      `${duplicatesRemoved} duplicates removed)`,
  );

  const firstPass = baseEventLoader(enhancedPointer);

  // Authors whose write list we could not answer synchronously. The memory LRU
  // and the EventStore are a CACHE, not the source of truth: a cold session
  // knows nobody's relays, and a reaction whose "e" tag carries no hint is then
  // routed to the fallback relays and nowhere else. So resolve the missing
  // lists — Dexie, then the indexers — and retry on what they name.
  const unresolvedAuthors = existingEvent
    ? [] // We already hold the event; there is nothing left to route.
    : authorCandidates.filter((pubkey) => outboxRelaysFor(pubkey).length === 0);

  if (unresolvedAuthors.length === 0) return firstPass;

  // `defer` so every gate below is evaluated at subscribe time, and re-evaluated
  // when the outbox lookups land — by then the first pass may have won.
  const secondPass = defer(() => {
    if (eventStore.getEvent(pointer.id)) return EMPTY;

    return forkJoin(unresolvedAuthors.map(resolveOutboxRelays)).pipe(
      switchMap((lists) => {
        // Won while we were looking: nothing to ask for.
        if (eventStore.getEvent(pointer.id)) return EMPTY;

        // Both sides through `mergeRelaySets` so the comparison is between
        // normalized URLs — otherwise a trailing slash defeats the dedupe and
        // we re-ask the same relay.
        const discovered = mergeRelaySets(
          ...lists.map((list) => list.slice(0, MAX_OUTBOX_RELAYS)),
        );
        const fresh = discovered.filter((url) => !allRelays.includes(url));
        if (fresh.length === 0) return EMPTY;

        console.debug(
          `[eventLoader] Second pass for ${pointer.id.slice(0, 8)}: ` +
            `${fresh.length} newly discovered relays from ` +
            `${unresolvedAuthors.length} resolved relay list(s)`,
        );

        return baseEventLoader({ id: pointer.id, relays: fresh });
      }),
    );
  });

  return merge(firstPass, secondPass);
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

/** How long to wait for a relay list before giving up on routing by it. */
const OUTBOX_RESOLVE_TIMEOUT = 15_000;

/**
 * A pubkey's NIP-65 write relays, from wherever they actually are.
 *
 * `outboxRelaysFor` above answers from the memory LRU and the EventStore only,
 * because every caller in `eventLoader`'s synchronous path needs an answer now.
 * That makes the cache the de facto source of truth, and on a cold session it
 * knows nobody — so this walks the rest of the way: Dexie (via the cache's own
 * async accessor), then the indexers.
 *
 * `baseBatchedAddressLoader`, not `batchedAddressLoader`: the wrapper's outbox
 * step is a no-op for kind 10002 (it is a `DISCOVERY_KIND`) and depending on
 * that incidentally would be asking the relay list to route its own lookup.
 * Batched, so a feed full of reactions from different authors costs one REQ per
 * 200ms window rather than one per author.
 *
 * The loader's emissions are ignored and the store is re-read once it
 * completes: a replaceable kind can emit an older event before a newer one, and
 * the EventStore has already picked the winner — which also warms the LRU
 * through `relayListCache`'s store subscription, so the next caller is a sync
 * hit. Always emits exactly one value, `[]` when nothing could be found.
 */
function resolveOutboxRelays(pubkey: string): Observable<string[]> {
  return from(relayListCache.getOutboxRelays(pubkey)).pipe(
    catchError(() => of(null)),
    switchMap((cached) => {
      if (cached?.length) return of(cached);

      return baseBatchedAddressLoader({ kind: 10002, pubkey }).pipe(
        // Before `ignoreElements`, so the deadline sees real emissions and is
        // cancelled by the loader completing on its own.
        timeout({ first: OUTBOX_RESOLVE_TIMEOUT }),
        catchError(() => EMPTY),
        ignoreElements(),
        // Runs however the lookup settled — found, empty or timed out. A silent
        // relay is not a failure to route: another subscription may have
        // delivered the list while we waited.
        concatWith(defer(() => of(outboxRelaysFor(pubkey)))),
      );
    }),
  );
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
