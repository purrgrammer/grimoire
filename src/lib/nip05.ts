import { queryProfile } from "nostr-tools/nip05";

/**
 * NIP-05 Identifier Resolution
 * Resolves user@domain identifiers to Nostr pubkeys using nostr-tools
 *
 * Supports both formats:
 * - user@domain.com
 * - domain.com (normalized to _@domain.com)
 */

/**
 * Check if a string looks like a NIP-05 identifier
 * Accepts both user@domain and bare domain formats
 */
export function isNip05(value: string): boolean {
  if (!value) return false;

  // Match user@domain format
  const userAtDomain =
    /^[a-zA-Z0-9._-]+@[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}$/.test(value);

  // Match bare domain format (domain.com -> _@domain.com)
  const bareDomain = /^[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}$/.test(value);

  return userAtDomain || bareDomain;
}

/**
 * Normalize a NIP-05 identifier
 * Converts bare domains to the _@domain format
 * @param value - NIP-05 identifier or bare domain
 * @returns Normalized identifier with @
 */
export function normalizeNip05(value: string): string {
  if (!value) return value;

  // Already in user@domain format
  if (value.includes("@")) {
    return value;
  }

  // Bare domain -> _@domain
  if (/^[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}$/.test(value)) {
    return `_@${value}`;
  }

  return value;
}

/**
 * Resolve a NIP-05 identifier to a pubkey using nostr-tools
 * @param nip05 - The NIP-05 identifier (user@domain, domain.com, or _@domain)
 * @returns The hex pubkey or null if resolution fails
 */
export async function resolveNip05(nip05: string): Promise<string | null> {
  if (!isNip05(nip05)) return null;

  // Normalize bare domains to _@domain
  const normalized = normalizeNip05(nip05);

  try {
    const profile = await queryProfile(normalized);

    if (!profile?.pubkey) {
      console.warn(`NIP-05: No pubkey found for ${normalized}`);
      return null;
    }

    console.log(
      `NIP-05: Resolved ${nip05} → ${normalized} → ${profile.pubkey}`,
    );
    return profile.pubkey.toLowerCase();
  } catch (error) {
    console.warn(`NIP-05: Resolution failed for ${normalized}:`, error);
    return null;
  }
}

/**
 * Resolve multiple NIP-05 identifiers in parallel
 * Automatically normalizes bare domains to _@domain format
 */
export async function resolveNip05Batch(
  identifiers: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  await Promise.all(
    identifiers.map(async (nip05) => {
      const pubkey = await resolveNip05(nip05);
      if (pubkey) {
        // Store with original identifier as key
        results.set(nip05, pubkey);
      }
    }),
  );

  return results;
}
