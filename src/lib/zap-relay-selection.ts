/**
 * Zap Relay Selection Utilities
 *
 * Provides optimal relay selection for zap receipts (kind 9735).
 * The relays tag in a zap request specifies where the zap receipt should be published.
 *
 * Priority order:
 * 1. Recipient's inbox (read) relays - so recipient sees the zap
 * 2. Sender's inbox (read) relays - so sender can verify the zap receipt
 * 3. Fallback aggregator relays - if neither party has relay preferences
 */

import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/** Maximum number of relays to include in zap request */
const MAX_ZAP_RELAYS = 10;

/** Minimum relays to ensure good coverage */
const MIN_RELAYS_PER_PARTY = 3;

export interface ZapRelaySelectionParams {
  /** Pubkey of the zap recipient */
  recipientPubkey: string;
  /** Pubkey of the zap sender (undefined for anonymous zaps) */
  senderPubkey?: string;
  /** Explicit relays to use (overrides automatic selection) */
  explicitRelays?: string[];
}

export interface ZapRelaySelectionResult {
  /** Selected relays for zap receipt publication */
  relays: string[];
  /** Debug info about relay sources */
  sources: {
    recipientInbox: string[];
    senderInbox: string[];
    fallback: string[];
  };
}

/**
 * Select optimal relays for zap receipt publication
 *
 * Strategy:
 * - Prioritize recipient's inbox relays (they need to see the zap)
 * - Add sender's inbox relays (they want to verify/see the receipt)
 * - Use fallback aggregators if neither has preferences
 * - Deduplicate and limit to MAX_ZAP_RELAYS
 */
export async function selectZapRelays(
  params: ZapRelaySelectionParams,
): Promise<ZapRelaySelectionResult> {
  const { recipientPubkey, senderPubkey, explicitRelays } = params;

  // If explicit relays provided, use them directly
  if (explicitRelays && explicitRelays.length > 0) {
    return {
      relays: explicitRelays.slice(0, MAX_ZAP_RELAYS),
      sources: {
        recipientInbox: [],
        senderInbox: [],
        fallback: [],
      },
    };
  }

  const sources = {
    recipientInbox: [] as string[],
    senderInbox: [] as string[],
    fallback: [] as string[],
  };

  // Fetch relays in parallel
  const [recipientInbox, senderInbox] = await Promise.all([
    relayListCache.getInboxRelays(recipientPubkey),
    senderPubkey ? relayListCache.getInboxRelays(senderPubkey) : null,
  ]);

  if (recipientInbox && recipientInbox.length > 0) {
    sources.recipientInbox = recipientInbox;
  }

  if (senderInbox && senderInbox.length > 0) {
    sources.senderInbox = senderInbox;
  }

  // Build relay list with priority ordering
  const relaySet = new Set<string>();

  // Priority 1: Recipient's inbox relays (take up to MIN_RELAYS_PER_PARTY first)
  for (const relay of sources.recipientInbox.slice(0, MIN_RELAYS_PER_PARTY)) {
    relaySet.add(relay);
  }

  // Priority 2: Sender's inbox relays (take up to MIN_RELAYS_PER_PARTY)
  for (const relay of sources.senderInbox.slice(0, MIN_RELAYS_PER_PARTY)) {
    relaySet.add(relay);
  }

  // Add remaining recipient relays
  for (const relay of sources.recipientInbox.slice(MIN_RELAYS_PER_PARTY)) {
    if (relaySet.size >= MAX_ZAP_RELAYS) break;
    relaySet.add(relay);
  }

  // Add remaining sender relays
  for (const relay of sources.senderInbox.slice(MIN_RELAYS_PER_PARTY)) {
    if (relaySet.size >= MAX_ZAP_RELAYS) break;
    relaySet.add(relay);
  }

  // Fallback to aggregator relays if we don't have enough
  if (relaySet.size === 0) {
    sources.fallback = [...AGGREGATOR_RELAYS];
    for (const relay of AGGREGATOR_RELAYS) {
      if (relaySet.size >= MAX_ZAP_RELAYS) break;
      relaySet.add(relay);
    }
  }

  return {
    relays: Array.from(relaySet),
    sources,
  };
}

/**
 * Get a simple list of relays for zap receipt publication
 * Convenience wrapper that just returns the relay URLs
 */
export async function getZapRelays(
  recipientPubkey: string,
  senderPubkey?: string,
): Promise<string[]> {
  const result = await selectZapRelays({ recipientPubkey, senderPubkey });
  return result.relays;
}
