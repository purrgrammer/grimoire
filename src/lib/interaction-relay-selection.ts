/**
 * Interaction Relay Selection Utilities
 *
 * Provides optimal relay selection for interactions (reactions, replies, etc.)
 * following the NIP-65 outbox model.
 *
 * For interactions, we need to publish to:
 * 1. Author's outbox (write) relays - where we publish our events
 * 2. Target's inbox (read) relays - so the target sees the interaction
 *
 * See: https://github.com/nostr-protocol/nips/blob/master/65.md
 */

import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/** Maximum number of relays to publish to */
const MAX_INTERACTION_RELAYS = 10;

/** Minimum relays per party for redundancy */
const MIN_RELAYS_PER_PARTY = 3;

export interface InteractionRelaySelectionParams {
  /** Pubkey of the interaction author (person reacting/replying) */
  authorPubkey: string;
  /** Pubkey of the target (person being reacted to/replied to) */
  targetPubkey: string;
}

export interface InteractionRelaySelectionResult {
  /** Selected relays for publishing the interaction */
  relays: string[];
  /** Debug info about relay sources */
  sources: {
    authorOutbox: string[];
    targetInbox: string[];
    fallback: string[];
  };
}

/**
 * Select optimal relays for publishing an interaction event (reaction, reply, etc.)
 *
 * Strategy per NIP-65:
 * - Author's outbox relays: where we publish our content
 * - Target's inbox relays: where the target reads mentions/interactions
 * - Fallback aggregators if neither has preferences
 * - Deduplicate and limit to MAX_INTERACTION_RELAYS
 */
export async function selectInteractionRelays(
  params: InteractionRelaySelectionParams,
): Promise<InteractionRelaySelectionResult> {
  const { authorPubkey, targetPubkey } = params;

  const sources = {
    authorOutbox: [] as string[],
    targetInbox: [] as string[],
    fallback: [] as string[],
  };

  // Fetch relays in parallel
  const [authorOutbox, targetInbox] = await Promise.all([
    relayListCache.getOutboxRelays(authorPubkey),
    relayListCache.getInboxRelays(targetPubkey),
  ]);

  if (authorOutbox && authorOutbox.length > 0) {
    sources.authorOutbox = authorOutbox;
  }

  if (targetInbox && targetInbox.length > 0) {
    sources.targetInbox = targetInbox;
  }

  // Build relay list with priority ordering
  const relaySet = new Set<string>();

  // Priority 1: Author's outbox relays (where we publish)
  for (const relay of sources.authorOutbox.slice(0, MIN_RELAYS_PER_PARTY)) {
    relaySet.add(relay);
  }

  // Priority 2: Target's inbox relays (so they see it)
  for (const relay of sources.targetInbox.slice(0, MIN_RELAYS_PER_PARTY)) {
    relaySet.add(relay);
  }

  // Add remaining author outbox relays
  for (const relay of sources.authorOutbox.slice(MIN_RELAYS_PER_PARTY)) {
    if (relaySet.size >= MAX_INTERACTION_RELAYS) break;
    relaySet.add(relay);
  }

  // Add remaining target inbox relays
  for (const relay of sources.targetInbox.slice(MIN_RELAYS_PER_PARTY)) {
    if (relaySet.size >= MAX_INTERACTION_RELAYS) break;
    relaySet.add(relay);
  }

  // Fallback to aggregator relays if we don't have enough
  if (relaySet.size === 0) {
    sources.fallback = [...AGGREGATOR_RELAYS];
    for (const relay of AGGREGATOR_RELAYS) {
      if (relaySet.size >= MAX_INTERACTION_RELAYS) break;
      relaySet.add(relay);
    }
  }

  return {
    relays: Array.from(relaySet),
    sources,
  };
}

/**
 * Get a simple list of relays for publishing an interaction
 * Convenience wrapper that just returns the relay URLs
 */
export async function getInteractionRelays(
  authorPubkey: string,
  targetPubkey: string,
): Promise<string[]> {
  const result = await selectInteractionRelays({
    authorPubkey,
    targetPubkey,
  });
  return result.relays;
}
