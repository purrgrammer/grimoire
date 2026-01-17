import { getTagValue } from "applesauce-core/helpers";
import { getTagValues } from "./nostr-utils";
import type { NostrEvent } from "nostr-tools";

/**
 * NIP-58 Badge Helpers
 * These helpers extract badge-related metadata from badge events.
 * They wrap getTagValue which caches results internally, so no need for useMemo.
 */

/**
 * Get the unique identifier for a badge (d tag)
 */
export function getBadgeIdentifier(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Get the display name for a badge
 */
export function getBadgeName(event: NostrEvent): string | undefined {
  return getTagValue(event, "name");
}

/**
 * Get the description explaining the badge meaning or issuance criteria
 */
export function getBadgeDescription(event: NostrEvent): string | undefined {
  return getTagValue(event, "description");
}

/**
 * Get the badge image URL and optional dimensions
 * @returns Object with url and optional dimensions (e.g., "1024x1024")
 */
export function getBadgeImage(event: NostrEvent): {
  url: string;
  dimensions?: string;
} | null {
  const imageTag = event.tags.find((tag) => tag[0] === "image" && tag[1]);
  if (!imageTag) return null;

  return {
    url: imageTag[1],
    dimensions: imageTag[2],
  };
}

/**
 * Get all thumbnail variants with dimensions
 * @returns Array of thumbnails with url and optional dimensions
 */
export function getBadgeThumbnails(event: NostrEvent): Array<{
  url: string;
  dimensions?: string;
}> {
  return event.tags
    .filter((tag) => tag[0] === "thumb" && tag[1])
    .map((tag) => ({
      url: tag[1],
      dimensions: tag[2],
    }));
}

/**
 * Get the best badge image URL to display based on available variants
 * Prefers image over thumbnails
 */
export function getBadgeImageUrl(event: NostrEvent): string | null {
  const image = getBadgeImage(event);
  if (image) return image.url;

  const thumbnails = getBadgeThumbnails(event);
  if (thumbnails.length > 0) return thumbnails[0].url;

  return null;
}

/**
 * Get all pubkeys awarded this badge (from kind 8 award events)
 * Note: This should be called on award events (kind 8), not badges (kind 30009)
 */
export function getAwardedPubkeys(awardEvent: NostrEvent): string[] {
  return getTagValues(awardEvent, "p");
}

/**
 * Get the badge address referenced by an award event (kind 8)
 * @returns The "a" tag value (e.g., "30009:pubkey:identifier")
 */
export function getAwardBadgeAddress(
  awardEvent: NostrEvent,
): string | undefined {
  return getTagValue(awardEvent, "a");
}

/**
 * Badge pair from Profile Badges event (kind 30008)
 * Contains references to both the badge definition and the award event
 */
export interface BadgePair {
  badgeAddress: string; // a tag - references badge definition (30009:pubkey:identifier)
  awardEventId: string; // e tag - references award event (kind 8)
}

/**
 * Extract ordered badge pairs from Profile Badges event (kind 30008)
 * Returns pairs of (badge definition address, award event id)
 */
export function getProfileBadgePairs(event: NostrEvent): BadgePair[] {
  const pairs: BadgePair[] = [];
  const aTags = event.tags.filter((tag) => tag[0] === "a" && tag[1]);
  const eTags = event.tags.filter((tag) => tag[0] === "e" && tag[1]);

  // Pair them up in order - each a tag should have a corresponding e tag
  const minLength = Math.min(aTags.length, eTags.length);
  for (let i = 0; i < minLength; i++) {
    pairs.push({
      badgeAddress: aTags[i][1],
      awardEventId: eTags[i][1],
    });
  }

  return pairs;
}
