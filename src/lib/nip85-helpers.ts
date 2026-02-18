import type { NostrEvent } from "@/types/nostr";
import { getOrComputeCachedValue, getTagValue } from "applesauce-core/helpers";

/**
 * NIP-85 Helper Functions
 * Utility functions for parsing NIP-85 Trusted Assertion events
 *
 * Kind 30382 - User Assertions (subject: pubkey)
 * Kind 30383 - Event Assertions (subject: event_id)
 * Kind 30384 - Addressable Event Assertions (subject: event_address)
 * Kind 30385 - External Identifier Assertions (subject: NIP-73 i-tag)
 * Kind 10040 - Trusted Provider List
 */

// ============================================================================
// Types
// ============================================================================

export interface AssertionTag {
  name: string;
  value: string;
}

export interface UserAssertionData {
  rank?: number;
  followers?: number;
  firstCreatedAt?: number;
  postCount?: number;
  replyCount?: number;
  reactionsCount?: number;
  zapAmountReceived?: number;
  zapAmountSent?: number;
  zapCountReceived?: number;
  zapCountSent?: number;
  zapAvgAmountDayReceived?: number;
  zapAvgAmountDaySent?: number;
  reportsReceived?: number;
  reportsSent?: number;
  topics?: string[];
  activeHoursStart?: number;
  activeHoursEnd?: number;
}

export interface EventAssertionData {
  rank?: number;
  commentCount?: number;
  quoteCount?: number;
  repostCount?: number;
  reactionCount?: number;
  zapCount?: number;
  zapAmount?: number;
}

export interface ExternalAssertionData {
  rank?: number;
  commentCount?: number;
  reactionCount?: number;
}

export interface TrustedProviderEntry {
  kindTag: string;
  servicePubkey: string;
  relay: string;
}

// ============================================================================
// Human-readable labels for assertion tags
// ============================================================================

export const ASSERTION_TAG_LABELS: Record<string, string> = {
  rank: "Rank",
  followers: "Followers",
  first_created_at: "First Post",
  post_cnt: "Posts",
  reply_cnt: "Replies",
  reactions_cnt: "Reactions",
  zap_amt_recd: "Zaps Received (sats)",
  zap_amt_sent: "Zaps Sent (sats)",
  zap_cnt_recd: "Zaps Received",
  zap_cnt_sent: "Zaps Sent",
  zap_avg_amt_day_recd: "Avg Zap/Day Received",
  zap_avg_amt_day_sent: "Avg Zap/Day Sent",
  reports_cnt_recd: "Reports Received",
  reports_cnt_sent: "Reports Sent",
  active_hours_start: "Active Start (UTC)",
  active_hours_end: "Active End (UTC)",
  comment_cnt: "Comments",
  quote_cnt: "Quotes",
  repost_cnt: "Reposts",
  reaction_cnt: "Reactions",
  zap_cnt: "Zaps",
  zap_amount: "Zap Amount (sats)",
};

/** Kind-specific subject type labels */
export const ASSERTION_KIND_LABELS: Record<number, string> = {
  30382: "User Assertion",
  30383: "Event Assertion",
  30384: "Address Assertion",
  30385: "External Assertion",
};

// ============================================================================
// Cache symbols
// ============================================================================

const AssertionTagsSymbol = Symbol("assertionTags");
const UserAssertionDataSymbol = Symbol("userAssertionData");
const EventAssertionDataSymbol = Symbol("eventAssertionData");
const ExternalAssertionDataSymbol = Symbol("externalAssertionData");
const TrustedProvidersSymbol = Symbol("trustedProviders");

// Tags that are structural, not result data
const STRUCTURAL_TAGS = new Set(["d", "p", "e", "a", "k"]);

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Get the subject of the assertion (d tag value)
 * - Kind 30382: pubkey
 * - Kind 30383: event_id
 * - Kind 30384: event_address (kind:pubkey:d-tag)
 * - Kind 30385: NIP-73 identifier
 */
export function getAssertionSubject(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Get all result tags (non-structural tags) as AssertionTag[]
 */
export function getAssertionTags(event: NostrEvent): AssertionTag[] {
  return getOrComputeCachedValue(event, AssertionTagsSymbol, () =>
    event.tags
      .filter((t) => !STRUCTURAL_TAGS.has(t[0]) && t[1] !== undefined)
      .map((t) => ({ name: t[0], value: t[1] })),
  );
}

// ============================================================================
// Kind 30382: User Assertion Helpers
// ============================================================================

function parseIntTag(event: NostrEvent, tag: string): number | undefined {
  const val = getTagValue(event, tag);
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * Get full parsed user assertion data (cached)
 */
export function getUserAssertionData(event: NostrEvent): UserAssertionData {
  return getOrComputeCachedValue(event, UserAssertionDataSymbol, () => {
    const topics = event.tags
      .filter((t) => t[0] === "t" && t[1])
      .map((t) => t[1]);

    return {
      rank: parseIntTag(event, "rank"),
      followers: parseIntTag(event, "followers"),
      firstCreatedAt: parseIntTag(event, "first_created_at"),
      postCount: parseIntTag(event, "post_cnt"),
      replyCount: parseIntTag(event, "reply_cnt"),
      reactionsCount: parseIntTag(event, "reactions_cnt"),
      zapAmountReceived: parseIntTag(event, "zap_amt_recd"),
      zapAmountSent: parseIntTag(event, "zap_amt_sent"),
      zapCountReceived: parseIntTag(event, "zap_cnt_recd"),
      zapCountSent: parseIntTag(event, "zap_cnt_sent"),
      zapAvgAmountDayReceived: parseIntTag(event, "zap_avg_amt_day_recd"),
      zapAvgAmountDaySent: parseIntTag(event, "zap_avg_amt_day_sent"),
      reportsReceived: parseIntTag(event, "reports_cnt_recd"),
      reportsSent: parseIntTag(event, "reports_cnt_sent"),
      topics: topics.length > 0 ? topics : undefined,
      activeHoursStart: parseIntTag(event, "active_hours_start"),
      activeHoursEnd: parseIntTag(event, "active_hours_end"),
    };
  });
}

// ============================================================================
// Kind 30383 / 30384: Event & Address Assertion Helpers
// ============================================================================

/**
 * Get full parsed event/address assertion data (cached)
 */
export function getEventAssertionData(event: NostrEvent): EventAssertionData {
  return getOrComputeCachedValue(event, EventAssertionDataSymbol, () => ({
    rank: parseIntTag(event, "rank"),
    commentCount: parseIntTag(event, "comment_cnt"),
    quoteCount: parseIntTag(event, "quote_cnt"),
    repostCount: parseIntTag(event, "repost_cnt"),
    reactionCount: parseIntTag(event, "reaction_cnt"),
    zapCount: parseIntTag(event, "zap_cnt"),
    zapAmount: parseIntTag(event, "zap_amount"),
  }));
}

// ============================================================================
// Kind 30385: External Assertion Helpers
// ============================================================================

/**
 * Get full parsed external assertion data (cached)
 */
export function getExternalAssertionData(
  event: NostrEvent,
): ExternalAssertionData {
  return getOrComputeCachedValue(event, ExternalAssertionDataSymbol, () => ({
    rank: parseIntTag(event, "rank"),
    commentCount: parseIntTag(event, "comment_cnt"),
    reactionCount: parseIntTag(event, "reaction_cnt"),
  }));
}

/**
 * Get NIP-73 k tags (type identifiers for external subjects)
 */
export function getExternalAssertionTypes(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "k" && t[1]).map((t) => t[1]);
}

// ============================================================================
// Kind 10040: Trusted Provider List Helpers
// ============================================================================

/**
 * Get public trusted provider entries from tags (cached)
 */
export function getTrustedProviders(event: NostrEvent): TrustedProviderEntry[] {
  return getOrComputeCachedValue(event, TrustedProvidersSymbol, () =>
    event.tags
      .filter((t) => t[0].includes(":") && t[1] && t[2])
      .map((t) => ({
        kindTag: t[0],
        servicePubkey: t[1],
        relay: t[2],
      })),
  );
}

/**
 * Check if the event has encrypted provider entries
 */
export function hasEncryptedProviders(event: NostrEvent): boolean {
  return event.content !== undefined && event.content.trim().length > 0;
}

/**
 * Format a kind:tag string for display (e.g., "30382:rank" → "User: Rank")
 */
export function formatKindTag(kindTag: string): string {
  const [kindStr, tag] = kindTag.split(":");
  const kind = parseInt(kindStr, 10);
  const kindLabel = ASSERTION_KIND_LABELS[kind] || `Kind ${kind}`;
  const tagLabel = tag ? ASSERTION_TAG_LABELS[tag] || tag : "";
  return tagLabel ? `${kindLabel}: ${tagLabel}` : kindLabel;
}
