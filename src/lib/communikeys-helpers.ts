import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

/**
 * Communikeys Helper Functions
 * Utility functions for parsing Communikeys events (kind 10222, kind 30222)
 *
 * Based on the Communikeys standard:
 * - Kind 10222: Community Creation Event (replaceable)
 * - Kind 30222: Targeted Publication Event (parameterized replaceable)
 *
 * Kind numbers:
 * - 10222 is in the replaceable event range (10000-19999)
 * - 30222 is in the parameterized replaceable event range (30000-39999)
 */

// ============================================================================
// Community Event Helpers (Kind 10222)
// ============================================================================

/**
 * Content section within a community definition
 * Groups related event kinds with optional badge requirements
 */
export interface ContentSection {
  name: string;
  kinds: number[];
  badgePointers: string[]; // a-tag references to badge definitions
}

/**
 * Get all relay URLs from a community event
 * First relay in the array is considered the main relay
 * @param event Community event (kind 10222)
 * @returns Array of relay URLs
 */
export function getCommunityRelays(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "r").map((t) => t[1]);
}

/**
 * Get the main relay URL for a community
 * @param event Community event (kind 10222)
 * @returns Main relay URL or undefined
 */
export function getCommunityMainRelay(event: NostrEvent): string | undefined {
  const relayTag = event.tags.find((t) => t[0] === "r");
  return relayTag ? relayTag[1] : undefined;
}

/**
 * Get all blossom server URLs from a community event
 * @param event Community event (kind 10222)
 * @returns Array of blossom server URLs
 */
export function getCommunityBlossomServers(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "blossom").map((t) => t[1]);
}

/**
 * Get all ecash mint URLs from a community event
 * Returns objects with URL and type (e.g., "cashu")
 * @param event Community event (kind 10222)
 * @returns Array of mint objects
 */
export function getCommunityMints(
  event: NostrEvent,
): Array<{ url: string; type?: string }> {
  return event.tags
    .filter((t) => t[0] === "mint")
    .map((t) => ({
      url: t[1],
      type: t[2], // e.g., "cashu"
    }));
}

/**
 * Get the community description
 * Falls back to event content if no description tag present
 * @param event Community event (kind 10222)
 * @returns Description text or undefined
 */
export function getCommunityDescription(event: NostrEvent): string | undefined {
  return getTagValue(event, "description") || event.content || undefined;
}

/**
 * Get the community location
 * @param event Community event (kind 10222)
 * @returns Location string or undefined
 */
export function getCommunityLocation(event: NostrEvent): string | undefined {
  return getTagValue(event, "location");
}

/**
 * Get the community geohash
 * @param event Community event (kind 10222)
 * @returns Geohash string or undefined
 */
export function getCommunityGeohash(event: NostrEvent): string | undefined {
  return getTagValue(event, "g");
}

/**
 * Get the terms of service reference for a community
 * Returns the event ID/address and optional relay hint
 * @param event Community event (kind 10222)
 * @returns TOS reference object or undefined
 */
export function getCommunityTos(
  event: NostrEvent,
): { reference: string; relay?: string } | undefined {
  const tosTag = event.tags.find((t) => t[0] === "tos");
  if (!tosTag || !tosTag[1]) return undefined;
  return {
    reference: tosTag[1],
    relay: tosTag[2],
  };
}

/**
 * Parse all content sections from a community event
 * Content sections define what types of events the community supports
 * and who can publish them (via badge requirements)
 *
 * Tags are sequential: ["content", "Chat"], ["k", "9"], ["a", "30009:..."]
 * Each content tag starts a new section; k and a tags belong to the preceding content
 *
 * @param event Community event (kind 10222)
 * @returns Array of content sections
 */
export function getCommunityContentSections(
  event: NostrEvent,
): ContentSection[] {
  const sections: ContentSection[] = [];
  let currentSection: ContentSection | null = null;

  for (const tag of event.tags) {
    if (tag[0] === "content" && tag[1]) {
      // Start a new content section
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        name: tag[1],
        kinds: [],
        badgePointers: [],
      };
    } else if (currentSection) {
      if (tag[0] === "k" && tag[1]) {
        // Add kind to current section
        const kind = parseInt(tag[1], 10);
        if (!isNaN(kind)) {
          currentSection.kinds.push(kind);
        }
      } else if (tag[0] === "a" && tag[1]) {
        // Add badge requirement to current section
        currentSection.badgePointers.push(tag[1]);
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
 * Get all unique event kinds supported by a community
 * Aggregates kinds from all content sections
 * @param event Community event (kind 10222)
 * @returns Array of unique kind numbers
 */
export function getCommunitySupportedKinds(event: NostrEvent): number[] {
  const sections = getCommunityContentSections(event);
  const kinds = new Set<number>();
  for (const section of sections) {
    for (const kind of section.kinds) {
      kinds.add(kind);
    }
  }
  return Array.from(kinds);
}

/**
 * Get all unique badge pointers required by a community
 * Aggregates badge requirements from all content sections
 * @param event Community event (kind 10222)
 * @returns Array of unique badge address pointers (a-tag format)
 */
export function getCommunityBadgeRequirements(event: NostrEvent): string[] {
  const sections = getCommunityContentSections(event);
  const badges = new Set<string>();
  for (const section of sections) {
    for (const badge of section.badgePointers) {
      badges.add(badge);
    }
  }
  return Array.from(badges);
}

// ============================================================================
// Targeted Publication Event Helpers (Kind 30222)
// ============================================================================

/**
 * Get the d-tag identifier for a targeted publication
 * @param event Targeted publication event (kind 30222)
 * @returns Identifier string or undefined
 */
export function getTargetedPublicationIdentifier(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Get the referenced event ID from a targeted publication
 * Uses the e-tag for non-addressable events
 * @param event Targeted publication event (kind 30222)
 * @returns Event ID or undefined
 */
export function getTargetedPublicationEventId(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "e");
}

/**
 * Get the referenced address pointer from a targeted publication
 * Uses the a-tag for addressable events
 * @param event Targeted publication event (kind 30222)
 * @returns Address pointer string (kind:pubkey:d-tag) or undefined
 */
export function getTargetedPublicationAddress(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "a");
}

/**
 * Get the kind of the original publication being targeted
 * @param event Targeted publication event (kind 30222)
 * @returns Kind number or undefined
 */
export function getTargetedPublicationKind(
  event: NostrEvent,
): number | undefined {
  const kTag = getTagValue(event, "k");
  if (!kTag) return undefined;
  const kind = parseInt(kTag, 10);
  return isNaN(kind) ? undefined : kind;
}

/**
 * Community target within a targeted publication
 * Contains the community pubkey and optional main relay
 */
export interface CommunityTarget {
  pubkey: string;
  relay?: string;
}

/**
 * Get all targeted communities from a targeted publication
 * Parses alternating p and r tags to build community targets
 * @param event Targeted publication event (kind 30222)
 * @returns Array of community targets
 */
export function getTargetedCommunities(event: NostrEvent): CommunityTarget[] {
  const communities: CommunityTarget[] = [];

  // Parse p and r tags sequentially
  // Each p tag is followed by its corresponding r tag
  const pTags = event.tags.filter((t) => t[0] === "p");
  const rTags = event.tags.filter((t) => t[0] === "r");

  for (let i = 0; i < pTags.length; i++) {
    const pubkey = pTags[i][1];
    if (pubkey) {
      communities.push({
        pubkey,
        relay: rTags[i]?.[1],
      });
    }
  }

  return communities;
}

// ============================================================================
// Community-Exclusive Event Helpers (Kind 9, Kind 11)
// ============================================================================

/**
 * Get the community pubkey from an exclusive event (kind 9, 11)
 * These events use an h-tag to reference their community
 * @param event Chat message (kind 9) or Forum post (kind 11)
 * @returns Community pubkey or undefined
 */
export function getExclusiveEventCommunity(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "h");
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an event is a Communikeys community event
 * @param event Nostr event
 * @returns True if kind 10222
 */
export function isCommunityEvent(event: NostrEvent): boolean {
  return event.kind === 10222;
}

/**
 * Check if an event is a Communikeys targeted publication event
 * @param event Nostr event
 * @returns True if kind 30222
 */
export function isTargetedPublicationEvent(event: NostrEvent): boolean {
  return event.kind === 30222;
}

/**
 * Check if a chat message or forum post belongs to a community
 * @param event Chat message (kind 9) or Forum post (kind 11)
 * @returns True if has h-tag (community reference)
 */
export function isExclusiveCommunityEvent(event: NostrEvent): boolean {
  return (event.kind === 9 || event.kind === 11) && !!getTagValue(event, "h");
}
