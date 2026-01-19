import {
  createEventLoader,
  createAddressLoader,
  createTimelineLoader,
  createEventLoaderForStore,
} from "applesauce-loaders/loaders";
import type { EventPointer } from "nostr-tools/nip19";
import { Observable } from "rxjs";
import { getSeenRelays, mergeRelaySets } from "applesauce-core/helpers/relays";
import { getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { getTagValue } from "applesauce-core/helpers/event";
import pool from "./relay-pool";
import eventStore from "./event-store";
import { relayListCache } from "./relay-list-cache";
import type { NostrEvent } from "@/types/nostr";

/**
 * Extract relay context from a Nostr event for comprehensive relay selection
 * Uses applesauce helpers for robust tag parsing and relay tracking
 */
function extractRelayContext(event: NostrEvent): {
  authorHint?: string;
  seenRelays: Set<string> | undefined;
  rTags: string[];
  eTagRelays: string[];
} {
  // Get relays where this event was seen (tracked by applesauce)
  const seenRelays = getSeenRelays(event);

  // Extract all "r" tags (URL references per NIP-01)
  const rTags = event.tags
    .filter((t) => t[0] === "r")
    .map((t) => t[1])
    .filter(Boolean);

  // Extract relay hints from all "e" tags using applesauce helper
  const eTagRelays = event.tags
    .filter((t) => t[0] === "e")
    .map((tag) => {
      const pointer = getEventPointerFromETag(tag);
      // v5: returns null for invalid tags instead of throwing
      return pointer?.relays?.[0]; // First relay hint from the pointer
    })
    .filter((relay): relay is string => relay !== undefined);

  // Extract first "p" tag as author hint using applesauce helper
  const authorHint = getTagValue(event, "p");

  return { seenRelays, authorHint, rTags, eTagRelays };
}

// Aggregator relays for better event discovery
// IMPORTANT: URLs must be normalized (trailing slash, lowercase) to match RelayStateManager keys
export const AGGREGATOR_RELAYS = [
  "wss://nos.lol/",
  "wss://purplepag.es/",
  "wss://relay.primal.net/",
];

// Base event loader (used internally)
const baseEventLoader = createEventLoader(pool, {
  eventStore,
  extraRelays: AGGREGATOR_RELAYS,
});

/**
 * Smart event loader that combines relay hints with cached relay lists
 *
 * Strategy (priority order):
 * 1. Direct relay hints from EventPointer
 * 2. Seen-at relays (where reply event was received)
 * 3. Author's cached outbox relays (from NIP-65)
 * 4. "r" tags from context event (URL references)
 * 5. Other "e" tag relay hints from context event
 * 6. Aggregator relays (fallback)
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
    }
  }

  // Get direct relay hints from EventPointer
  const directHints = (pointer as EventPointer).relays || [];

  // Try to get cached outbox relays
  let cachedOutboxRelays: string[] = [];

  // Check if event already exists in store
  const existingEvent = eventStore.getEvent(pointer.id);
  if (existingEvent) {
    cachedOutboxRelays =
      relayListCache.getOutboxRelaysSync(existingEvent.pubkey) || [];
  }

  // If not in store but we have author hint (from reply "p" tag)
  if (cachedOutboxRelays.length === 0 && authorHint) {
    cachedOutboxRelays = relayListCache.getOutboxRelaysSync(authorHint) || [];
  }

  // Limit cached relays to top 3 to avoid too many connections
  const topCachedRelays = cachedOutboxRelays.slice(0, 3);

  // Merge all relay sources with priority ordering
  // mergeRelaySets handles deduplication, normalization, and invalid URL filtering
  const allRelays = mergeRelaySets(
    directHints, // Priority 1: Direct hints (most specific)
    seenRelays, // Priority 2: Where reply was seen (high confidence)
    topCachedRelays, // Priority 3: Author's outbox (NIP-65 standard)
    rTags, // Priority 4: Conversation context
    eTagRelays, // Priority 5: Other event references
    AGGREGATOR_RELAYS, // Priority 6: Fallback
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
    rTags.length +
    eTagRelays.length +
    AGGREGATOR_RELAYS.length;

  const duplicatesRemoved = totalSources - allRelays.length;

  console.debug(
    `[eventLoader] Fetching ${pointer.id.slice(0, 8)} from ${allRelays.length} relays ` +
      `(direct=${directHints.length} seen=${seenRelays?.size || 0} cached=${topCachedRelays.length} ` +
      `r=${rTags.length} e=${eTagRelays.length} agg=${AGGREGATOR_RELAYS.length}, ` +
      `${duplicatesRemoved} duplicates removed)`,
  );

  return baseEventLoader(enhancedPointer);
}

// Address loader for replaceable events (profiles, relay lists, etc.)
export const addressLoader = createAddressLoader(pool, {
  eventStore,
  extraRelays: AGGREGATOR_RELAYS,
});

// Profile loader with batching - combines multiple profile requests within 200ms
export const profileLoader = createAddressLoader(pool, {
  eventStore,
  bufferTime: 200, // Batch requests within 200ms window
  extraRelays: AGGREGATOR_RELAYS,
});

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
 * - extraRelays: AGGREGATOR_RELAYS - fallback relay discovery
 *
 * Note: The custom eventLoader() function above is still available for
 * explicit loading with smart relay hint merging from context events.
 */
createEventLoaderForStore(eventStore, pool, {
  bufferTime: 200,
  extraRelays: AGGREGATOR_RELAYS,
});
