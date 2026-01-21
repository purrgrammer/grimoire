/**
 * Relay Resolver Service
 *
 * Encapsulates all relay selection logic for publishing.
 * Provides consistent relay resolution with health filtering.
 */

import type { NostrEvent } from "nostr-tools/core";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { normalizeRelayURL } from "@/lib/relay-url";
import { relayListCache } from "./relay-list-cache";
import liveness from "./relay-liveness";
import { AGGREGATOR_RELAYS } from "./loaders";
import type { RelayMode } from "@/types/publishing";

/**
 * Result of relay resolution
 */
export interface RelayResolutionResult {
  /** The resolved relay URLs (normalized, deduplicated) */
  relays: string[];
  /** Source of the relays */
  source: "explicit" | "outbox" | "seen" | "fallback";
  /** Original relay count before filtering */
  originalCount: number;
  /** Count after health filtering */
  filteredCount: number;
}

class RelayResolver {
  /**
   * Resolve relay mode to actual relay URLs
   *
   * For outbox mode, uses cascade:
   * 1. Author's outbox relays (NIP-65)
   * 2. Seen relays (where event was discovered)
   * 3. AGGREGATOR_RELAYS fallback
   *
   * For explicit mode, uses provided relays with optional health filtering.
   */
  async resolve(
    mode: RelayMode,
    event: NostrEvent,
    options: { filterUnhealthy?: boolean } = {},
  ): Promise<RelayResolutionResult> {
    const { filterUnhealthy = true } = options;

    if (mode.mode === "explicit") {
      const normalized = this.normalizeRelays(mode.relays);
      const filtered = filterUnhealthy
        ? this.filterHealthy(normalized)
        : normalized;

      return {
        relays: filtered,
        source: "explicit",
        originalCount: mode.relays.length,
        filteredCount: filtered.length,
      };
    }

    // Outbox mode - cascade through sources
    return this.resolveOutbox(event.pubkey, event, filterUnhealthy);
  }

  /**
   * Resolve outbox relays for a pubkey
   * Cascades through: outbox -> seen -> fallback
   */
  async resolveOutbox(
    pubkey: string,
    event?: NostrEvent,
    filterUnhealthy = true,
  ): Promise<RelayResolutionResult> {
    // Try author's outbox relays first
    const outbox = await relayListCache.getOutboxRelays(pubkey);
    if (outbox && outbox.length > 0) {
      const filtered = filterUnhealthy ? this.filterHealthy(outbox) : outbox;
      if (filtered.length > 0) {
        return {
          relays: filtered,
          source: "outbox",
          originalCount: outbox.length,
          filteredCount: filtered.length,
        };
      }
    }

    // Try seen relays if event provided
    if (event) {
      const seenRelays = getSeenRelays(event);
      if (seenRelays && seenRelays.size > 0) {
        const seenArray = this.normalizeRelays(Array.from(seenRelays));
        const filtered = filterUnhealthy
          ? this.filterHealthy(seenArray)
          : seenArray;
        if (filtered.length > 0) {
          return {
            relays: filtered,
            source: "seen",
            originalCount: seenRelays.size,
            filteredCount: filtered.length,
          };
        }
      }
    }

    // Fallback to aggregator relays
    const fallback = filterUnhealthy
      ? this.filterHealthy(AGGREGATOR_RELAYS)
      : AGGREGATOR_RELAYS;

    return {
      relays: fallback.length > 0 ? fallback : AGGREGATOR_RELAYS,
      source: "fallback",
      originalCount: AGGREGATOR_RELAYS.length,
      filteredCount: fallback.length,
    };
  }

  /**
   * Normalize relay URLs and deduplicate
   */
  normalizeRelays(relays: string[]): string[] {
    const normalized = new Set<string>();

    for (const relay of relays) {
      try {
        const url = normalizeRelayURL(relay);
        normalized.add(url);
      } catch (error) {
        console.warn(`[RelayResolver] Invalid relay URL: ${relay}`, error);
      }
    }

    return Array.from(normalized);
  }

  /**
   * Filter relays using RelayLiveness
   * Removes relays that are in backoff or dead state
   */
  filterHealthy(relays: string[]): string[] {
    return liveness.filter(relays);
  }

  /**
   * Merge multiple relay sources with deduplication
   */
  mergeRelays(...relaySources: (string[] | undefined)[]): string[] {
    const merged = new Set<string>();

    for (const source of relaySources) {
      if (source) {
        for (const relay of source) {
          try {
            const url = normalizeRelayURL(relay);
            merged.add(url);
          } catch {
            // Skip invalid URLs
          }
        }
      }
    }

    return Array.from(merged);
  }

  /**
   * Get synchronous outbox relays (memory cache only)
   * Returns null if not in cache
   */
  getOutboxRelaysSync(pubkey: string): string[] | null {
    return relayListCache.getOutboxRelaysSync(pubkey);
  }

  /**
   * Check if a relay is healthy
   */
  isHealthy(relay: string): boolean {
    const filtered = this.filterHealthy([relay]);
    return filtered.length > 0;
  }
}

// Singleton instance
export const relayResolver = new RelayResolver();
export default relayResolver;
