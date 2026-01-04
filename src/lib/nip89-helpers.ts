import { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers";

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
 * Extract app name from kind 31990 event content JSON or fallback to d tag
 */
export function getAppName(event: NostrEvent): string {
  if (event.kind !== 31990) return "";

  // Try to parse content as JSON
  if (event.content) {
    try {
      const metadata = JSON.parse(event.content);
      if (metadata.name) return metadata.name;
    } catch {
      // Not valid JSON, continue to fallback
    }
  }

  // Fallback to d tag identifier
  const dTag = getTagValue(event, "d");
  return dTag || "Unknown App";
}

/**
 * Extract app description from kind 31990 event content JSON
 */
export function getAppDescription(event: NostrEvent): string | undefined {
  if (event.kind !== 31990 || !event.content) return undefined;

  try {
    const metadata = JSON.parse(event.content);
    return metadata.description;
  } catch {
    return undefined;
  }
}

/**
 * Extract app image URL from kind 31990 event content JSON
 */
export function getAppImage(event: NostrEvent): string | undefined {
  if (event.kind !== 31990 || !event.content) return undefined;

  try {
    const metadata = JSON.parse(event.content);
    return metadata.image || metadata.picture;
  } catch {
    return undefined;
  }
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
export function getPlatformUrls(
  event: NostrEvent
): Record<string, string> {
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
  for (const tag of event.tags) {
    const tagName = tag[0];
    const tagValue = tag[1];
    if (
      tagValue &&
      !knownPlatforms.includes(tagName) &&
      tagName !== "d" &&
      tagName !== "k"
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

    references.push({
      address,
      relayHint: relayHint || undefined,
      platform: platform || undefined,
    });
  }

  return references;
}

/**
 * Get handler references filtered by platform
 */
export function getHandlersByPlatform(
  event: NostrEvent,
  platform?: string
): HandlerReference[] {
  const allRefs = getHandlerReferences(event);

  if (!platform) return allRefs;

  return allRefs.filter((ref) => ref.platform === platform);
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

// ============================================================================
// URL Template Utilities
// ============================================================================

/**
 * Substitute <bech32> placeholder in URL template with actual bech32 entity
 */
export function substituteTemplate(
  template: string,
  bech32Entity: string
): string {
  return template.replace(/<bech32>/g, bech32Entity);
}

/**
 * Check if a string contains the <bech32> placeholder
 */
export function hasPlaceholder(template: string): boolean {
  return template.includes("<bech32>");
}

/**
 * Format an address pointer as a string for display
 * Format: "kind:pubkey:identifier"
 */
export function formatAddressPointer(pointer: AddressPointer): string {
  return `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
}
