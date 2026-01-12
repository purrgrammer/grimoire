import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

/**
 * Communikeys Helper Functions
 * Utility functions for parsing Communikey events (kind 10222 and 30222)
 *
 * Kind 10222: Community Definition Event
 * Kind 30222: Targeted Publication Event
 */

// ============================================================================
// Types
// ============================================================================

export interface ContentSection {
  name: string;
  kinds: number[];
  fee?: { amount: number; unit: string };
  exclusive?: boolean;
  badgeRequirement?: string; // "a" tag value like "30009:pubkey:badge-id"
}

export interface CommunikeyConfig {
  relays: string[];
  blossomServers: string[];
  mints: string[];
  contentSections: ContentSection[];
  description?: string;
  tos?: { id: string; relay?: string };
  location?: string;
  geohash?: string;
}

export interface TargetedCommunity {
  pubkey: string;
  relay?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
}

// ============================================================================
// Community Definition Event Helpers (Kind 10222)
// ============================================================================

/**
 * Get all relay URLs from a community definition event
 * @param event Community event (kind 10222)
 * @returns Array of relay URLs
 */
export function getCommunikeyRelays(event: NostrEvent): string[] {
  return getTagValues(event, "r");
}

/**
 * Get the main (first) relay URL from a community definition event
 * @param event Community event (kind 10222)
 * @returns Main relay URL or undefined
 */
export function getCommunikeyMainRelay(event: NostrEvent): string | undefined {
  return getTagValue(event, "r");
}

/**
 * Get all blossom server URLs from a community definition event
 * @param event Community event (kind 10222)
 * @returns Array of blossom server URLs
 */
export function getCommunikeyBlossomServers(event: NostrEvent): string[] {
  return getTagValues(event, "blossom");
}

/**
 * Get all ecash mint URLs from a community definition event
 * @param event Community event (kind 10222)
 * @returns Array of mint URLs with their protocols
 */
export function getCommunikeyMints(
  event: NostrEvent,
): Array<{ url: string; protocol?: string }> {
  return event.tags
    .filter((t) => t[0] === "mint")
    .map((t) => ({ url: t[1], protocol: t[2] }));
}

/**
 * Get the description override from a community definition event
 * @param event Community event (kind 10222)
 * @returns Description string or undefined
 */
export function getCommunikeyDescription(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "description");
}

/**
 * Get the terms of service reference from a community definition event
 * @param event Community event (kind 10222)
 * @returns ToS object with event ID and optional relay, or undefined
 */
export function getCommunikeyTos(
  event: NostrEvent,
): { id: string; relay?: string } | undefined {
  const tosTag = event.tags.find((t) => t[0] === "tos");
  if (!tosTag) return undefined;
  return { id: tosTag[1], relay: tosTag[2] };
}

/**
 * Get the location from a community definition event
 * @param event Community event (kind 10222)
 * @returns Location string or undefined
 */
export function getCommunikeyLocation(event: NostrEvent): string | undefined {
  return getTagValue(event, "location");
}

/**
 * Get the geohash from a community definition event
 * @param event Community event (kind 10222)
 * @returns Geohash string or undefined
 */
export function getCommunikeyGeohash(event: NostrEvent): string | undefined {
  return getTagValue(event, "g");
}

/**
 * Parse content sections from a community definition event
 * Content sections are defined by sequential tags starting with ["content", "name"]
 * followed by k, fee, exclusive, and a (badge) tags that apply to that section
 *
 * @param event Community event (kind 10222)
 * @returns Array of parsed content sections
 */
export function getCommunikeyContentSections(
  event: NostrEvent,
): ContentSection[] {
  const sections: ContentSection[] = [];
  let currentSection: ContentSection | null = null;

  for (const tag of event.tags) {
    const [tagName, ...values] = tag;

    if (tagName === "content") {
      // Start a new section
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        name: values[0] || "Unnamed",
        kinds: [],
      };
    } else if (currentSection) {
      // Only process these tags if we're in a content section
      switch (tagName) {
        case "k":
          // Add kind to current section
          const kind = parseInt(values[0], 10);
          if (!isNaN(kind)) {
            currentSection.kinds.push(kind);
          }
          break;
        case "fee":
          // Fee format: ["fee", "amount", "unit"]
          const amount = parseInt(values[0], 10);
          if (!isNaN(amount)) {
            currentSection.fee = { amount, unit: values[1] || "sat" };
          }
          break;
        case "exclusive":
          currentSection.exclusive = values[0] === "true";
          break;
        case "a":
          // Badge requirement - only set if it looks like a badge address (30009:...)
          if (values[0]?.startsWith("30009:")) {
            currentSection.badgeRequirement = values[0];
          }
          break;
      }
    }
  }

  // Don't forget the last section
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Get the full community configuration from a kind 10222 event
 * @param event Community event (kind 10222)
 * @returns Parsed community configuration
 */
export function getCommunikeyConfig(event: NostrEvent): CommunikeyConfig {
  return {
    relays: getCommunikeyRelays(event),
    blossomServers: getCommunikeyBlossomServers(event),
    mints: getCommunikeyMints(event).map((m) => m.url),
    contentSections: getCommunikeyContentSections(event),
    description: getCommunikeyDescription(event),
    tos: getCommunikeyTos(event),
    location: getCommunikeyLocation(event),
    geohash: getCommunikeyGeohash(event),
  };
}

/**
 * Check if a kind is supported in any content section of the community
 * @param event Community event (kind 10222)
 * @param kind Event kind to check
 * @returns True if the kind is supported
 */
export function isCommunikeyKindSupported(
  event: NostrEvent,
  kind: number,
): boolean {
  const sections = getCommunikeyContentSections(event);
  return sections.some((s) => s.kinds.includes(kind));
}

/**
 * Get the content section that supports a specific kind
 * @param event Community event (kind 10222)
 * @param kind Event kind to find
 * @returns The content section supporting this kind, or undefined
 */
export function getCommunikeySectionForKind(
  event: NostrEvent,
  kind: number,
): ContentSection | undefined {
  const sections = getCommunikeyContentSections(event);
  return sections.find((s) => s.kinds.includes(kind));
}

// ============================================================================
// Targeted Publication Event Helpers (Kind 30222)
// ============================================================================

/**
 * Get the original event ID from a targeted publication event
 * @param event Targeted publication event (kind 30222)
 * @returns Event ID or undefined
 */
export function getTargetedPublicationEventId(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "e");
}

/**
 * Get the original event address from a targeted publication event
 * Used for addressable events (kinds 30000-39999)
 * @param event Targeted publication event (kind 30222)
 * @returns Event address or undefined
 */
export function getTargetedPublicationAddress(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "a");
}

/**
 * Get the original publication's kind from a targeted publication event
 * @param event Targeted publication event (kind 30222)
 * @returns Event kind or undefined
 */
export function getTargetedPublicationKind(
  event: NostrEvent,
): number | undefined {
  const kindStr = getTagValue(event, "k");
  if (!kindStr) return undefined;
  const kind = parseInt(kindStr, 10);
  return isNaN(kind) ? undefined : kind;
}

/**
 * Get all targeted communities from a targeted publication event
 * Communities are specified via p tags with optional r tags for relay hints
 *
 * @param event Targeted publication event (kind 30222)
 * @returns Array of targeted community objects with pubkey and optional relay
 */
export function getTargetedCommunities(event: NostrEvent): TargetedCommunity[] {
  const communities: TargetedCommunity[] = [];
  const relayHints: string[] = [];

  // Collect relay hints
  for (const tag of event.tags) {
    if (tag[0] === "r" && tag[1]) {
      relayHints.push(tag[1]);
    }
  }

  // Collect community pubkeys and pair with relays
  let relayIndex = 0;
  for (const tag of event.tags) {
    if (tag[0] === "p" && tag[1]) {
      communities.push({
        pubkey: tag[1],
        relay: relayHints[relayIndex],
      });
      relayIndex++;
    }
  }

  return communities;
}

/**
 * Get just the community pubkeys from a targeted publication event
 * @param event Targeted publication event (kind 30222)
 * @returns Array of community pubkeys
 */
export function getTargetedCommunityPubkeys(event: NostrEvent): string[] {
  return getTagValues(event, "p");
}

/**
 * Check if a publication targets a specific community
 * @param event Targeted publication event (kind 30222)
 * @param communityPubkey The community pubkey to check
 * @returns True if the publication targets this community
 */
export function isTargetedToCommunity(
  event: NostrEvent,
  communityPubkey: string,
): boolean {
  return getTargetedCommunityPubkeys(event).includes(communityPubkey);
}

// ============================================================================
// Community-Exclusive Content Helpers (h tag)
// ============================================================================

/**
 * Get the community pubkey from an exclusive content event (e.g., kind 9 chat)
 * @param event Content event with h tag
 * @returns Community pubkey or undefined
 */
export function getExclusiveCommunityPubkey(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "h");
}

/**
 * Check if an event is exclusive community content
 * @param event Any event
 * @returns True if the event has an h tag (community-exclusive)
 */
export function isExclusiveCommunityContent(event: NostrEvent): boolean {
  return event.tags.some((t) => t[0] === "h");
}
