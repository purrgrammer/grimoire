/**
 * Shared relay utilities for chat adapters
 *
 * Provides reusable functions for relay selection,
 * outbox resolution, and relay set merging.
 */

import { firstValueFrom } from "rxjs";
import { normalizeURL } from "applesauce-core/helpers";
import eventStore from "@/services/event-store";
import { AGGREGATOR_RELAYS as LOADERS_AGGREGATOR_RELAYS } from "@/services/loaders";

// Re-export aggregator relays for convenience
export const AGGREGATOR_RELAYS = LOADERS_AGGREGATOR_RELAYS;

export interface OutboxRelayOptions {
  /** Maximum number of relays to return (default: 5) */
  maxRelays?: number;
  /** Log prefix for debugging */
  logPrefix?: string;
}

/**
 * Get outbox (write) relays for a pubkey via NIP-65
 *
 * Fetches kind 10002 relay list and extracts write relays.
 * Falls back to empty array if no relay list found.
 *
 * @param pubkey - The pubkey to get outbox relays for
 * @param options - Options
 * @returns Array of normalized relay URLs
 */
export async function getOutboxRelays(
  pubkey: string,
  options: OutboxRelayOptions = {},
): Promise<string[]> {
  const { maxRelays = 5, logPrefix = "[RelayUtils]" } = options;

  try {
    const relayList = await firstValueFrom(
      eventStore.replaceable(10002, pubkey, ""),
      { defaultValue: undefined },
    );

    if (!relayList) return [];

    // Extract write relays (r tags with "write" marker or no marker)
    const writeRelays = relayList.tags
      .filter((t) => {
        if (t[0] !== "r") return false;
        const marker = t[2];
        return !marker || marker === "write";
      })
      .map((t) => {
        try {
          return normalizeURL(t[1]);
        } catch {
          return t[1]; // Return unnormalized if normalization fails
        }
      })
      .filter(Boolean);

    return writeRelays.slice(0, maxRelays);
  } catch (err) {
    console.warn(
      `${logPrefix} Failed to get outbox relays for ${pubkey}:`,
      err,
    );
    return [];
  }
}

/**
 * Get inbox (read) relays for a pubkey via NIP-65
 *
 * Fetches kind 10002 relay list and extracts read relays.
 * Falls back to empty array if no relay list found.
 *
 * @param pubkey - The pubkey to get inbox relays for
 * @param options - Options
 * @returns Array of normalized relay URLs
 */
export async function getInboxRelays(
  pubkey: string,
  options: OutboxRelayOptions = {},
): Promise<string[]> {
  const { maxRelays = 5, logPrefix = "[RelayUtils]" } = options;

  try {
    const relayList = await firstValueFrom(
      eventStore.replaceable(10002, pubkey, ""),
      { defaultValue: undefined },
    );

    if (!relayList) return [];

    // Extract read relays (r tags with "read" marker or no marker)
    const readRelays = relayList.tags
      .filter((t) => {
        if (t[0] !== "r") return false;
        const marker = t[2];
        return !marker || marker === "read";
      })
      .map((t) => {
        try {
          return normalizeURL(t[1]);
        } catch {
          return t[1];
        }
      })
      .filter(Boolean);

    return readRelays.slice(0, maxRelays);
  } catch (err) {
    console.warn(`${logPrefix} Failed to get inbox relays for ${pubkey}:`, err);
    return [];
  }
}

export interface MergeRelaysOptions {
  /** Maximum total relays to return (default: 10) */
  maxRelays?: number;
  /** Fallback relays if result is empty or below minimum */
  fallbackRelays?: string[];
  /** Minimum relays needed before adding fallback (default: 3) */
  minRelays?: number;
}

/**
 * Merge multiple relay sources into a deduplicated, normalized list
 *
 * Relays are added in order of priority (first sources have higher priority).
 * Duplicates are removed using normalized URLs.
 *
 * @param relaySources - Arrays of relay URLs in priority order
 * @param options - Merge options
 * @returns Deduplicated array of normalized relay URLs
 */
export function mergeRelays(
  relaySources: string[][],
  options: MergeRelaysOptions = {},
): string[] {
  const {
    maxRelays = 10,
    fallbackRelays = AGGREGATOR_RELAYS,
    minRelays = 3,
  } = options;

  const seen = new Set<string>();
  const result: string[] = [];

  // Add relays from each source in order
  for (const source of relaySources) {
    for (const relay of source) {
      if (!relay) continue;

      try {
        const normalized = normalizeURL(relay);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          result.push(normalized);
        }
      } catch {
        // Skip invalid URLs
      }

      // Stop if we have enough
      if (result.length >= maxRelays) {
        return result;
      }
    }
  }

  // Add fallback relays if we don't have enough
  if (result.length < minRelays) {
    for (const relay of fallbackRelays) {
      try {
        const normalized = normalizeURL(relay);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          result.push(normalized);
        }
      } catch {
        // Skip invalid URLs
      }

      if (result.length >= maxRelays) {
        break;
      }
    }
  }

  return result;
}

/**
 * Collect relays from multiple pubkeys' outboxes
 *
 * Fetches outbox relays for each pubkey and merges them.
 * Useful for getting relays for thread participants.
 *
 * @param pubkeys - Array of pubkeys to get outboxes for
 * @param options - Options including max relays per pubkey
 * @returns Merged array of relay URLs
 */
export async function collectOutboxRelays(
  pubkeys: string[],
  options: OutboxRelayOptions & MergeRelaysOptions = {},
): Promise<string[]> {
  const { maxRelays: perPubkeyMax = 3 } = options;

  const relaySources: string[][] = [];

  for (const pubkey of pubkeys.slice(0, 5)) {
    // Limit to 5 pubkeys
    const outbox = await getOutboxRelays(pubkey, { maxRelays: perPubkeyMax });
    if (outbox.length > 0) {
      relaySources.push(outbox);
    }
  }

  return mergeRelays(relaySources, options);
}
