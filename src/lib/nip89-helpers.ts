import { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { AddressPointer } from "nostr-tools/nip19";

/**
 * NIP-89 Helper Functions
 * For working with Application Handler (31990) and Handler Recommendation (31989) events
 */

/**
 * Get all values for a tag name (plural version of getTagValue)
 * Unlike getTagValue which returns first match, this returns all matches
 */
function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName)
    .map((tag) => tag[1])
    .filter((val): val is string => val !== undefined);
}

// ============================================================================
// Kind 31990 (Application Handler) Helpers
// ============================================================================

/**
 * Get parsed metadata from kind 31990 event content JSON
 * Caches the parsed result to avoid redundant JSON.parse calls
 */
function getAppMetadata(event: NostrEvent): Record<string, any> | null {
  if (event.kind !== 31990 || !event.content) return null;

  // Use a symbol as cache key to avoid property name conflicts
  const cacheKey = Symbol.for("nip89-metadata");
  const cached = (event as any)[cacheKey];
  if (cached !== undefined) return cached;

  try {
    const metadata = JSON.parse(event.content);
    if (metadata && typeof metadata === "object") {
      (event as any)[cacheKey] = metadata;
      return metadata;
    }
  } catch {
    // Invalid JSON
  }

  (event as any)[cacheKey] = null;
  return null;
}

/**
 * Extract app name from kind 31990 event content JSON or fallback to d tag
 */
export function getAppName(event: NostrEvent): string {
  if (event.kind !== 31990) return "";

  const metadata = getAppMetadata(event);
  if (metadata?.name && typeof metadata.name === "string") {
    return metadata.name;
  }

  // Fallback to d tag identifier
  const dTag = getTagValue(event, "d");
  return dTag && typeof dTag === "string" ? dTag : "Unknown App";
}

/**
 * Extract app description from kind 31990 event content JSON
 * Checks both 'description' and 'about' fields
 */
export function getAppDescription(event: NostrEvent): string | undefined {
  if (event.kind !== 31990) return undefined;

  const metadata = getAppMetadata(event);
  if (metadata) {
    // Check description first, then about (common in kind 0 profile format)
    const desc = metadata.description || metadata.about;
    if (desc && typeof desc === "string") {
      return desc;
    }
  }

  return undefined;
}

/**
 * Extract website URL from kind 31990 event content JSON
 */
export function getAppWebsite(event: NostrEvent): string | undefined {
  if (event.kind !== 31990) return undefined;

  const metadata = getAppMetadata(event);
  if (metadata?.website && typeof metadata.website === "string") {
    return metadata.website;
  }

  return undefined;
}

/**
 * Get all supported kinds from k tags in kind 31990 event
 */
export function getSupportedKinds(event: NostrEvent): number[] {
  if (event.kind !== 31990) return [];

  const kindTags = getTagValues(event, "k");
  return kindTags
    .map((k) => parseInt(k, 10))
    .filter((k) => !isNaN(k))
    .sort((a, b) => a - b); // Sort numerically
}

/**
 * Get platform-specific URL templates from kind 31990 event
 * Returns a map of platform name to URL template
 */
export function getPlatformUrls(event: NostrEvent): Record<string, string> {
  if (event.kind !== 31990) return {};

  const platforms: Record<string, string> = {};
  const knownPlatforms = ["web", "ios", "android", "macos", "windows", "linux"];

  for (const platform of knownPlatforms) {
    const url = getTagValue(event, platform);
    if (url) {
      platforms[platform] = url;
    }
  }

  // Also check for any other platform tags
  // Exclude common non-platform tags: d, k, r, t, client, etc.
  const excludedTags = ["d", "k", "r", "t", "client", "alt", "e", "p", "a"];
  for (const tag of event.tags) {
    const tagName = tag[0];
    const tagValue = tag[1];
    if (
      tagValue &&
      !knownPlatforms.includes(tagName) &&
      !excludedTags.includes(tagName)
    ) {
      // Could be a custom platform tag
      if (tagValue.includes("://") || tagValue.includes("<bech32>")) {
        platforms[tagName] = tagValue;
      }
    }
  }

  return platforms;
}

/**
 * Get available platforms for kind 31990 event
 */
export function getAvailablePlatforms(event: NostrEvent): string[] {
  return Object.keys(getPlatformUrls(event));
}

/**
 * Get the d tag identifier from kind 31990 event
 */
export function getHandlerIdentifier(event: NostrEvent): string | undefined {
  if (event.kind !== 31990) return undefined;
  return getTagValue(event, "d");
}

// ============================================================================
// Kind 31989 (Handler Recommendation) Helpers
// ============================================================================

/**
 * Get the recommended event kind from kind 31989 d tag
 */
export function getRecommendedKind(event: NostrEvent): number | undefined {
  if (event.kind !== 31989) return undefined;

  const dTag = getTagValue(event, "d");
  if (!dTag) return undefined;

  const kind = parseInt(dTag, 10);
  return isNaN(kind) ? undefined : kind;
}

/**
 * Parse an address pointer from an a tag value
 * Format: "kind:pubkey:identifier"
 */
export function parseAddressPointer(aTagValue: string): AddressPointer | null {
  const parts = aTagValue.split(":");
  if (parts.length !== 3) return null;

  const kind = parseInt(parts[0], 10);
  const pubkey = parts[1];
  const identifier = parts[2];

  if (isNaN(kind) || !pubkey || identifier === undefined) return null;

  return {
    kind,
    pubkey,
    identifier,
  };
}

/**
 * Handler reference with additional metadata from a tag
 */
export interface HandlerReference {
  address: AddressPointer;
  relayHint?: string;
  platform?: string;
}

/**
 * Get all handler references from kind 31989 a tags
 */
export function getHandlerReferences(event: NostrEvent): HandlerReference[] {
  if (event.kind !== 31989) return [];

  const references: HandlerReference[] = [];

  const aTags = event.tags.filter((tag) => tag[0] === "a");

  for (const tag of aTags) {
    const aTagValue = tag[1];
    if (!aTagValue) continue;

    const address = parseAddressPointer(aTagValue);
    if (!address) continue;

    const relayHint = tag[2];
    const platform = tag[3];
    // Only include relay hint if it's a valid websocket URL
    const validRelayHint =
      relayHint && isSafeRelayURL(relayHint) ? relayHint : undefined;

    references.push({
      address,
      relayHint: validRelayHint,
      platform: platform || undefined,
    });
  }

  return references;
}

/**
 * Get unique platforms from handler references in kind 31989
 */
export function getRecommendedPlatforms(event: NostrEvent): string[] {
  const refs = getHandlerReferences(event);
  const platforms = new Set<string>();

  for (const ref of refs) {
    if (ref.platform) {
      platforms.add(ref.platform);
    }
  }

  return Array.from(platforms).sort();
}
