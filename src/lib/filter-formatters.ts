import { nip19 } from "nostr-tools";
import { formatTimestamp } from "@/hooks/useLocale";
import type { ProfileMetadata } from "@/types/profile";

/**
 * Truncate a bech32-encoded string (note1..., npub1..., etc.)
 * @param bech32 - Full bech32 string
 * @returns Truncated string like "note1abc...xyz"
 */
function truncateBech32(bech32: string): string {
  if (bech32.length <= 20) return bech32;

  // Find prefix length (note1, npub1, etc.)
  const prefixMatch = bech32.match(/^[a-z]+1/);
  const prefixLen = prefixMatch ? prefixMatch[0].length : 5;

  // Show prefix + first 6 chars + ... + last 4 chars
  const start = bech32.slice(0, prefixLen + 6);
  const end = bech32.slice(-4);
  return `${start}...${end}`;
}

/**
 * Format a list with truncation (e.g., "item1, item2 & 3 more")
 * @param items - Array of strings to format
 * @param maxDisplay - Maximum items to display before truncating
 * @returns Formatted string with truncation
 */
function formatList(items: string[], maxDisplay: number): string {
  if (items.length === 0) return "";
  if (items.length <= maxDisplay) return items.join(", ");

  const displayed = items.slice(0, maxDisplay);
  const remaining = items.length - maxDisplay;
  return `${displayed.join(", ")} & ${remaining} more`;
}

/**
 * Format event IDs to truncated note1... strings
 * @param ids - Hex event IDs (64-char hex strings)
 * @param maxDisplay - Maximum IDs to show before truncating (default: 2)
 * @returns Formatted string like "note1abc...xyz, note1def...uvw & 3 more"
 */
export function formatEventIds(ids: string[], maxDisplay = 2): string {
  if (!ids || ids.length === 0) return "";

  const encoded = ids
    .map((id) => {
      try {
        const note = nip19.noteEncode(id);
        return truncateBech32(note);
      } catch {
        // Fallback for invalid IDs: truncate hex
        return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
      }
    });

  return formatList(encoded, maxDisplay);
}

/**
 * Format d-tags with quotes and truncation
 * @param tags - Array of d-tag strings
 * @param maxDisplay - Maximum tags to show before truncating (default: 2)
 * @returns Formatted string like '"note-1", "note-2" & 1 more'
 */
export function formatDTags(tags: string[], maxDisplay = 2): string {
  if (!tags || tags.length === 0) return "";

  const quoted = tags.map((tag) => `"${tag}"`);
  return formatList(quoted, maxDisplay);
}

/**
 * Format time range with relative and absolute display
 * @param since - Unix timestamp (seconds) for start time
 * @param until - Unix timestamp (seconds) for end time
 * @returns Formatted string like "2025-12-10 14:30 (3d ago) → now"
 */
export function formatTimeRange(since?: number, until?: number): string {
  if (!since && !until) return "";

  const parts: string[] = [];

  if (since) {
    const absolute = formatTimestamp(since, "absolute");
    const relative = formatTimestamp(since, "relative");
    parts.push(`${absolute} (${relative})`);
  }

  if (until) {
    // Check if until is approximately now (within 60 seconds)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - until) < 60) {
      parts.push("now");
    } else {
      const absolute = formatTimestamp(until, "absolute");
      const relative = formatTimestamp(until, "relative");
      parts.push(`${absolute} (${relative})`);
    }
  }

  return parts.join(" → ");
}

/**
 * Format time range in compact form for window titles
 * @param since - Unix timestamp (seconds) for start time
 * @param until - Unix timestamp (seconds) for end time
 * @returns Compact string like "last 3d" or "since 2d ago"
 */
export function formatTimeRangeCompact(since?: number, until?: number): string {
  if (!since && !until) return "";

  const now = Math.floor(Date.now() / 1000);

  // If both since and until, and until is approximately now
  if (since && until && Math.abs(now - until) < 60) {
    const relative = formatTimestamp(since, "relative");
    return `last ${relative.replace(" ago", "")}`;
  }

  // If only since
  if (since && !until) {
    const relative = formatTimestamp(since, "relative");
    return `since ${relative}`;
  }

  // If only until
  if (until && !since) {
    if (Math.abs(now - until) < 60) {
      return "until now";
    }
    const relative = formatTimestamp(until, "relative");
    return `until ${relative}`;
  }

  // Both with specific until
  if (since && until) {
    const sinceRel = formatTimestamp(since, "relative");
    const untilRel = formatTimestamp(until, "relative");
    return `${sinceRel} → ${untilRel}`;
  }

  return "";
}

/**
 * Format generic tag with letter prefix
 * @param letter - Single letter tag identifier (e.g., 'a', 'r', 'g')
 * @param values - Array of tag values
 * @param maxDisplay - Maximum values to show before truncating (default: 2)
 * @returns Formatted string like "#a: val1, val2 & 1 more"
 */
export function formatGenericTag(
  letter: string,
  values: string[],
  maxDisplay = 2,
): string {
  if (!values || values.length === 0) return "";

  // Truncate long values (e.g., URLs, addresses)
  const truncated = values.map((val) => {
    if (val.length > 40) {
      return `${val.slice(0, 20)}...${val.slice(-10)}`;
    }
    return val;
  });

  const formatted = formatList(truncated, maxDisplay);
  return `#${letter}: ${formatted}`;
}

/**
 * Format pubkeys with profile names and npub encoding
 * @param pubkeys - Array of hex pubkeys
 * @param profiles - Array of loaded ProfileMetadata objects (may be sparse)
 * @param maxDisplay - Maximum pubkeys to show before truncating (default: 2)
 * @returns Formatted string like "npub1... (Alice), npub1... (Bob) & 2 more"
 */
export function formatPubkeysWithProfiles(
  pubkeys: string[],
  profiles: (ProfileMetadata | null | undefined)[],
  maxDisplay = 2,
): string {
  if (!pubkeys || pubkeys.length === 0) return "";

  const formatted = pubkeys.map((pubkey, index) => {
    const profile = profiles[index];
    const npub = nip19.npubEncode(pubkey);
    const truncatedNpub = truncateBech32(npub);

    if (profile?.name) {
      return `${truncatedNpub} (${profile.name})`;
    }

    return truncatedNpub;
  });

  return formatList(formatted, maxDisplay);
}

/**
 * Format hashtags with # prefix and truncation
 * @param tags - Array of hashtag strings (without # prefix)
 * @param maxDisplay - Maximum hashtags to show before truncating (default: 2)
 * @returns Formatted string like "#bitcoin, #nostr & 3 more"
 */
export function formatHashtags(tags: string[], maxDisplay = 2): string {
  if (!tags || tags.length === 0) return "";

  const withHash = tags.map((tag) => `#${tag}`);
  return formatList(withHash, maxDisplay);
}

/**
 * Format profile names for display
 * @param profiles - Array of ProfileMetadata objects
 * @param maxDisplay - Maximum profiles to show before truncating (default: 2)
 * @returns Formatted string like "Alice, Bob & 2 more"
 */
export function formatProfileNames(
  profiles: ProfileMetadata[],
  maxDisplay = 2,
): string {
  if (!profiles || profiles.length === 0) return "";

  const names = profiles
    .map((p) => p.name || p.display_name || "Unknown")
    .filter(Boolean);

  return formatList(names, maxDisplay);
}
