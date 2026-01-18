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

/**
 * Domain Directory Resolution (@domain syntax)
 * Resolves @domain to all pubkeys in domain's NIP-05 directory
 */

// Cache for domain directory lookups (domain -> {pubkeys, timestamp})
const domainDirectoryCache = new Map<
  string,
  { pubkeys: string[]; timestamp: number }
>();
const DOMAIN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a string looks like a domain (for @domain syntax)
 */
export function isDomain(value: string): boolean {
  if (!value) return false;
  return /^[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}$/.test(value);
}

/**
 * Fetch all pubkeys from a domain's NIP-05 directory
 * @param domain - Domain name (e.g., "habla.news")
 * @returns Array of hex pubkeys from the domain's nostr.json
 */
export async function resolveDomainDirectory(
  domain: string,
): Promise<string[]> {
  // Normalize domain to lowercase
  const normalizedDomain = domain.toLowerCase();

  // Check cache first
  const cached = domainDirectoryCache.get(normalizedDomain);
  if (cached && Date.now() - cached.timestamp < DOMAIN_CACHE_TTL) {
    console.log(`Domain directory cache hit for @${normalizedDomain}`);
    return cached.pubkeys;
  }

  try {
    const url = `https://${normalizedDomain}/.well-known/nostr.json`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!response.ok) {
      console.warn(
        `Domain directory fetch failed for @${normalizedDomain}: ${response.status}`,
      );
      return [];
    }

    const data = await response.json();

    if (!data.names || typeof data.names !== "object") {
      console.warn(`Invalid nostr.json format for @${normalizedDomain}`);
      return [];
    }

    // Extract all pubkeys from the names object
    const pubkeys = Object.values(data.names)
      .filter((pk): pk is string => typeof pk === "string")
      .map((pk) => pk.toLowerCase());

    console.log(
      `Resolved @${normalizedDomain} → ${pubkeys.length} pubkeys`,
      pubkeys.slice(0, 5),
    );

    // Cache the result
    domainDirectoryCache.set(normalizedDomain, {
      pubkeys,
      timestamp: Date.now(),
    });

    return pubkeys;
  } catch (error) {
    console.warn(
      `Domain directory resolution failed for @${normalizedDomain}:`,
      error,
    );
    return [];
  }
}

/**
 * Resolve multiple domain directories in parallel
 * @param domains - Array of domain names
 * @returns Map of domain -> pubkeys array
 */
export async function resolveDomainDirectoryBatch(
  domains: string[],
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();

  await Promise.all(
    domains.map(async (domain) => {
      const pubkeys = await resolveDomainDirectory(domain);
      if (pubkeys.length > 0) {
        // Store with original domain as key
        results.set(domain, pubkeys);
      }
    }),
  );

  return results;
}
