/**
 * Write Relay Selection Utilities
 *
 * Core infrastructure for selecting optimal relays to publish events.
 * Provides multiple selection strategies that can be combined:
 * - Pubkey-based: Use author's NIP-65 outbox relays (where they publish)
 * - Seen-based: Use relays where related events were seen
 * - Fallback: Use well-known aggregator relays
 *
 * All utilities are pure functions for easy testing and composition.
 */

import type { NostrEvent } from "@/types/nostr";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { getOutboxes } from "applesauce-core/helpers";
import { normalizeRelayURL } from "./relay-url";
import eventStore from "@/services/event-store";

/**
 * Well-known aggregator relays for fallback
 * These relays are highly available and accept most events
 */
export const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
] as const;

/**
 * Result of relay selection with reasoning
 */
export interface WriteRelaySelectionResult {
  /** Selected relay URLs (normalized) */
  relays: string[];
  /** Reasoning for why these relays were selected */
  strategy: WriteRelayStrategy;
  /** Source pubkeys that contributed relays */
  sources: string[];
}

/**
 * Strategy used for relay selection
 */
export type WriteRelayStrategy =
  | "pubkey-outbox" // From NIP-65 relay lists
  | "event-seen" // From where events were observed
  | "combined" // Multiple strategies merged
  | "fallback"; // Default aggregators

/**
 * Options for relay selection
 */
export interface WriteRelaySelectionOptions {
  /** Maximum number of relays to return */
  maxRelays?: number;
  /** Filter out localhost/tor relays */
  sanitize?: boolean;
  /** Include fallback relays if insufficient relays found */
  includeFallback?: boolean;
}

/**
 * Sanitizes relay URLs by removing localhost and TOR relays
 *
 * @param relays - Array of relay URLs
 * @returns Filtered array without localhost or TOR relays
 *
 * @example
 * sanitizeRelays(["wss://relay.damus.io", "ws://localhost:7777"])
 * // => ["wss://relay.damus.io"]
 */
export function sanitizeRelays(relays: string[]): string[] {
  return relays.filter((url) => {
    // Remove localhost relays
    if (/^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
      return false;
    }
    // Remove TOR relays (*.onion)
    if (/\.onion/i.test(url)) {
      return false;
    }
    return true;
  });
}

/**
 * Normalizes and deduplicates relay URLs
 *
 * @param relays - Array of potentially unnormalized relay URLs
 * @returns Array of normalized, deduplicated URLs
 *
 * @example
 * normalizeAndDedupe(["wss://relay.damus.io/", "wss://relay.damus.io"])
 * // => ["wss://relay.damus.io"]
 */
export function normalizeAndDedupe(relays: string[]): string[] {
  const normalized = new Set<string>();

  for (const relay of relays) {
    try {
      const normalizedUrl = normalizeRelayURL(relay);
      normalized.add(normalizedUrl);
    } catch (err) {
      // Skip invalid URLs
      console.debug(
        `[WriteRelaySelection] Skipping invalid URL: ${relay}`,
        err,
      );
    }
  }

  return Array.from(normalized);
}

/**
 * Gets write relays for a pubkey from their NIP-65 relay list (kind 10002)
 *
 * @param pubkey - Hex pubkey to get write relays for
 * @param options - Selection options
 * @returns Write relay selection result
 *
 * @example
 * const result = getWriteRelaysForPubkey("abc123...");
 * console.log(result.relays); // ["wss://relay1.com", "wss://relay2.com"]
 * console.log(result.strategy); // "pubkey-outbox"
 */
export function getWriteRelaysForPubkey(
  pubkey: string,
  options: WriteRelaySelectionOptions = {},
): WriteRelaySelectionResult {
  const { maxRelays = 5, sanitize = true, includeFallback = true } = options;

  // Get relay list from event store (synchronous)
  const relayListEvent = eventStore.getReplaceable(10002, pubkey, "");

  if (!relayListEvent) {
    // No relay list found - use fallback
    if (includeFallback) {
      return {
        relays: FALLBACK_RELAYS.slice(0, maxRelays),
        strategy: "fallback",
        sources: [],
      };
    }
    return {
      relays: [],
      strategy: "pubkey-outbox",
      sources: [],
    };
  }

  // Extract outbox (write) relays
  let relays = Array.from(getOutboxes(relayListEvent));

  // Normalize and deduplicate
  relays = normalizeAndDedupe(relays);

  // Sanitize if requested
  if (sanitize) {
    relays = sanitizeRelays(relays);
  }

  // Limit to max
  relays = relays.slice(0, maxRelays);

  // Add fallback if insufficient relays
  if (includeFallback && relays.length < 2) {
    const needed = Math.min(maxRelays - relays.length, FALLBACK_RELAYS.length);
    const fallbacks = FALLBACK_RELAYS.slice(0, needed).filter(
      (r) => !relays.includes(r),
    );
    relays = [...relays, ...fallbacks];
  }

  return {
    relays,
    strategy: "pubkey-outbox",
    sources: [pubkey],
  };
}

/**
 * Gets relays where an event was seen
 *
 * @param event - Nostr event to get seen relays for
 * @param options - Selection options
 * @returns Write relay selection result
 *
 * @example
 * const result = getRelaysWhereEventSeen(someEvent);
 * console.log(result.relays); // ["wss://relay1.com", "wss://relay2.com"]
 * console.log(result.strategy); // "event-seen"
 */
export function getRelaysWhereEventSeen(
  event: NostrEvent,
  options: WriteRelaySelectionOptions = {},
): WriteRelaySelectionResult {
  const { maxRelays = 5, sanitize = true, includeFallback = true } = options;

  // Get relays where event was seen
  const seenRelaysSet = getSeenRelays(event);
  let relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

  // Normalize and deduplicate
  relays = normalizeAndDedupe(relays);

  // Sanitize if requested
  if (sanitize) {
    relays = sanitizeRelays(relays);
  }

  // Limit to max
  relays = relays.slice(0, maxRelays);

  // Add fallback if insufficient relays
  if (includeFallback && relays.length < 2) {
    const needed = Math.min(maxRelays - relays.length, FALLBACK_RELAYS.length);
    const fallbacks = FALLBACK_RELAYS.slice(0, needed).filter(
      (r) => !relays.includes(r),
    );
    relays = [...relays, ...fallbacks];
  }

  return {
    relays,
    strategy: "event-seen",
    sources: [event.pubkey],
  };
}

/**
 * Combines multiple relay selection strategies
 *
 * Merges relays from multiple sources, prioritizing:
 * 1. Event seen relays (most relevant)
 * 2. Pubkey outbox relays (where author publishes)
 * 3. Fallback relays (if needed)
 *
 * @param sources - Array of selection results to combine
 * @param options - Selection options
 * @returns Combined write relay selection result
 *
 * @example
 * const eventRelays = getRelaysWhereEventSeen(event);
 * const authorRelays = getWriteRelaysForPubkey(event.pubkey);
 * const combined = combineRelayStrategies([eventRelays, authorRelays]);
 * console.log(combined.relays); // Merged and deduplicated
 */
export function combineRelayStrategies(
  sources: WriteRelaySelectionResult[],
  options: WriteRelaySelectionOptions = {},
): WriteRelaySelectionResult {
  const { maxRelays = 5, sanitize = true, includeFallback = true } = options;

  // Merge all relays, preserving order (event-seen first)
  const allRelays: string[] = [];
  const allSources = new Set<string>();

  for (const source of sources) {
    for (const relay of source.relays) {
      if (!allRelays.includes(relay)) {
        allRelays.push(relay);
      }
    }
    source.sources.forEach((s) => allSources.add(s));
  }

  let relays = allRelays;

  // Sanitize if requested
  if (sanitize) {
    relays = sanitizeRelays(relays);
  }

  // Limit to max
  relays = relays.slice(0, maxRelays);

  // Add fallback if insufficient relays
  if (includeFallback && relays.length < 2) {
    const needed = Math.min(maxRelays - relays.length, FALLBACK_RELAYS.length);
    const fallbacks = FALLBACK_RELAYS.slice(0, needed).filter(
      (r) => !relays.includes(r),
    );
    relays = [...relays, ...fallbacks];
  }

  return {
    relays,
    strategy: "combined",
    sources: Array.from(allSources),
  };
}

/**
 * Gets optimal write relays for publishing an event
 *
 * Uses combined strategy:
 * 1. Relays where related events were seen
 * 2. Author's outbox relays
 * 3. Fallback to aggregators if needed
 *
 * @param pubkey - Author's pubkey
 * @param relatedEvents - Related events to consider (optional)
 * @param options - Selection options
 * @returns Optimal write relay selection
 *
 * @example
 * // For a reply to an existing event
 * const relays = getOptimalWriteRelays(
 *   myPubkey,
 *   [parentEvent],
 *   { maxRelays: 3 }
 * );
 *
 * // For a new post
 * const relays = getOptimalWriteRelays(myPubkey);
 */
export function getOptimalWriteRelays(
  pubkey: string,
  relatedEvents: NostrEvent[] = [],
  options: WriteRelaySelectionOptions = {},
): WriteRelaySelectionResult {
  const sources: WriteRelaySelectionResult[] = [];

  // 1. Get relays from related events (highest priority)
  for (const event of relatedEvents) {
    sources.push(
      getRelaysWhereEventSeen(event, { ...options, includeFallback: false }),
    );
  }

  // 2. Get author's outbox relays
  sources.push(
    getWriteRelaysForPubkey(pubkey, { ...options, includeFallback: false }),
  );

  // Combine all strategies
  return combineRelayStrategies(sources, options);
}
