import { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { AddressPointer } from "nostr-tools/nip19";

/**
 * Zapstore Helper Functions
 * For working with App Metadata (32267) and App Curation Set (30267) events
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
// Kind 32267 (App Metadata) Helpers
// ============================================================================

/**
 * Get app name from kind 32267 name tag
 */
export function getAppName(event: NostrEvent): string {
  if (event.kind !== 32267) return "";

  const name = getTagValue(event, "name");
  if (name && typeof name === "string") {
    return name;
  }

  // Fallback to d tag identifier
  const dTag = getTagValue(event, "d");
  return dTag && typeof dTag === "string" ? dTag : "Unknown App";
}

/**
 * Get app identifier from kind 32267 d tag (like package name)
 */
export function getAppIdentifier(event: NostrEvent): string | undefined {
  if (event.kind !== 32267) return undefined;
  return getTagValue(event, "d");
}

/**
 * Get app summary/description from kind 32267 summary tag
 */
export function getAppSummary(event: NostrEvent): string | undefined {
  if (event.kind !== 32267) return undefined;

  const summary = getTagValue(event, "summary");
  if (summary && typeof summary === "string") {
    return summary;
  }

  // Fallback to content if no summary tag
  return event.content || undefined;
}

/**
 * Get repository URL from kind 32267 repository tag
 */
export function getAppRepository(event: NostrEvent): string | undefined {
  if (event.kind !== 32267) return undefined;
  return getTagValue(event, "repository");
}

/**
 * Get app icon URL from kind 32267 icon tag
 */
export function getAppIcon(event: NostrEvent): string | undefined {
  if (event.kind !== 32267) return undefined;
  return getTagValue(event, "icon");
}

/**
 * Get app screenshot URLs from kind 32267 image tags (multiple)
 */
export function getAppImages(event: NostrEvent): string[] {
  if (event.kind !== 32267) return [];
  return getTagValues(event, "image");
}

/**
 * Get app license from kind 32267 license tag
 */
export function getAppLicense(event: NostrEvent): string | undefined {
  if (event.kind !== 32267) return undefined;
  return getTagValue(event, "license");
}

/**
 * Get supported platforms/architectures from kind 32267 f tags
 */
export function getAppPlatforms(event: NostrEvent): string[] {
  if (event.kind !== 32267) return [];
  return getTagValues(event, "f");
}

/**
 * Platform names for display
 */
export type Platform =
  | "android"
  | "ios"
  | "web"
  | "linux"
  | "windows"
  | "macos";

/**
 * Detect unique platforms from f tags
 * Normalizes architecture-specific tags (e.g., "android-arm64-v8a" → "android")
 */
export function detectPlatforms(event: NostrEvent): Platform[] {
  if (event.kind !== 32267 && event.kind !== 1063) return [];

  const fTags = getTagValues(event, "f");
  const platformSet = new Set<Platform>();

  for (const tag of fTags) {
    const lower = tag.toLowerCase();

    if (lower.startsWith("android")) {
      platformSet.add("android");
    } else if (lower.startsWith("ios") || lower.includes("iphone")) {
      platformSet.add("ios");
    } else if (lower === "web" || lower.includes("web")) {
      platformSet.add("web");
    } else if (lower.includes("linux")) {
      platformSet.add("linux");
    } else if (lower.includes("windows") || lower.includes("win")) {
      platformSet.add("windows");
    } else if (
      lower.includes("macos") ||
      lower.includes("mac") ||
      lower.includes("darwin")
    ) {
      platformSet.add("macos");
    }
  }

  // Sort for consistent order
  return Array.from(platformSet).sort();
}

/**
 * Get release artifact references from kind 32267 a tags (usually kind 30063)
 */
export function getAppReleases(event: NostrEvent): AddressPointer[] {
  if (event.kind !== 32267) return [];

  const aTags = event.tags.filter((tag) => tag[0] === "a");
  const releases: AddressPointer[] = [];

  for (const tag of aTags) {
    const aTagValue = tag[1];
    if (!aTagValue) continue;

    const address = parseAddressPointer(aTagValue);
    if (address) {
      releases.push(address);
    }
  }

  return releases;
}

// ============================================================================
// Kind 30267 (App Curation Set) Helpers
// ============================================================================

/**
 * Get curation set name from kind 30267 name tag
 */
export function getCurationSetName(event: NostrEvent): string {
  if (event.kind !== 30267) return "";

  const name = getTagValue(event, "name");
  if (name && typeof name === "string") {
    return name;
  }

  // Fallback to d tag identifier
  const dTag = getTagValue(event, "d");
  return dTag && typeof dTag === "string" ? dTag : "Unnamed Collection";
}

/**
 * Get curation set identifier from kind 30267 d tag
 */
export function getCurationSetIdentifier(
  event: NostrEvent,
): string | undefined {
  if (event.kind !== 30267) return undefined;
  return getTagValue(event, "d");
}

/**
 * App reference with relay hint from a tag
 */
export interface AppReference {
  address: AddressPointer;
  relayHint?: string;
}

/**
 * Get all app references from kind 30267 a tags
 */
export function getAppReferences(event: NostrEvent): AppReference[] {
  if (event.kind !== 30267) return [];

  const references: AppReference[] = [];
  const aTags = event.tags.filter((tag) => tag[0] === "a");

  for (const tag of aTags) {
    const aTagValue = tag[1];
    if (!aTagValue) continue;

    const address = parseAddressPointer(aTagValue);
    if (!address) continue;

    // Kind 32267 apps are expected in curation sets
    if (address.kind === 32267) {
      const relayHint = tag[2];
      // Only include relay hint if it's a valid websocket URL
      const validRelayHint =
        relayHint && isSafeRelayURL(relayHint) ? relayHint : undefined;
      references.push({
        address,
        relayHint: validRelayHint,
      });
    }
  }

  return references;
}

// ============================================================================
// Kind 30063 (Release) Helpers
// ============================================================================

/**
 * Get release identifier from kind 30063 d tag
 * Usually in format: package@version (e.g., "com.wavves.app@1.0.0")
 */
export function getReleaseIdentifier(event: NostrEvent): string | undefined {
  if (event.kind !== 30063) return undefined;
  return getTagValue(event, "d");
}

/**
 * Get version from release identifier
 * Extracts version from "package@version" format
 */
export function getReleaseVersion(event: NostrEvent): string | undefined {
  if (event.kind !== 30063) return undefined;

  const identifier = getReleaseIdentifier(event);
  if (!identifier) return undefined;

  // Try to extract version after @ symbol
  const atIndex = identifier.lastIndexOf("@");
  if (atIndex !== -1 && atIndex < identifier.length - 1) {
    return identifier.substring(atIndex + 1);
  }

  return undefined;
}

/**
 * Get file metadata event ID from kind 30063 e tag
 * Points to kind 1063 (File Metadata) event
 */
export function getReleaseFileEventId(event: NostrEvent): string | undefined {
  if (event.kind !== 30063) return undefined;
  return getTagValue(event, "e");
}

/**
 * Get app metadata pointer from kind 30063 a tag
 * Points to kind 32267 (App Metadata) event
 */
export function getReleaseAppPointer(event: NostrEvent): AddressPointer | null {
  if (event.kind !== 30063) return null;

  const aTag = getTagValue(event, "a");
  if (!aTag) return null;

  const pointer = parseAddressPointer(aTag);
  // Verify it points to an app metadata event
  if (pointer && pointer.kind === 32267) {
    return pointer;
  }

  return null;
}

// ============================================================================
// Shared Helpers
// ============================================================================

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
