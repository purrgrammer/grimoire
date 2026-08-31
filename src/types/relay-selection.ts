/**
 * NIP-65 Relay Selection Types
 *
 * Types for intelligent relay selection based on the NIP-65 outbox model.
 * See: https://github.com/nostr-protocol/nips/blob/master/65.md
 */

/**
 * Result of relay selection for a filter
 */
export interface RelaySelectionResult {
  /** Selected relay URLs (normalized) */
  relays: string[];

  /** Explanation of why each relay was selected */
  reasoning: RelaySelectionReasoning[];

  /** True if using NIP-65 optimization, false if using fallback */
  isOptimized: boolean;

  /**
   * Relays this selection dropped because they are on the user's NIP-51
   * kind-10006 blocked list.
   *
   * Recorded rather than silently discarded: without it a `$contacts` query
   * reports "42 relays" with no hint that six of the relays its contacts
   * actually publish to were skipped, which reads as missing coverage with no
   * cause. Required, not optional, so a new selection path cannot forget it.
   */
  blocked: BlockedRelayExclusion[];
}

/** A relay excluded from a selection by the blocked-relay list, and who wanted it. */
export interface BlockedRelayExclusion {
  /** Relay URL (normalized) */
  relay: string;

  /** Pubkeys that publish here (outbox), and so lose coverage */
  writers: string[];

  /** Pubkeys that read here (inbox) */
  readers: string[];
}

/**
 * Reasoning for why a relay was selected
 */
export interface RelaySelectionReasoning {
  /** Relay URL (normalized) */
  relay: string;

  /** Pubkeys using this relay for writing (outbox) */
  writers: string[];

  /** Pubkeys using this relay for reading (inbox) */
  readers: string[];

  /** True if this is a fallback relay */
  isFallback: boolean;
}

/**
 * Options for relay selection
 */
export interface RelaySelectionOptions {
  /** Maximum total relays to select (default: 42) */
  maxRelays?: number;

  /** Maximum relays per user for redundancy (default: 6) */
  maxRelaysPerUser?: number;

  /** Fallback relays when user has no kind:10002 */
  fallbackRelays?: string[];

  /** Timeout in ms for fetching kind:10002 events (default: 1000) */
  timeout?: number;
}
