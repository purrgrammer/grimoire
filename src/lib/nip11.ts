import { RelayInformation } from "../types/nip11";
import db from "../services/db";
import { normalizeRelayURL } from "./relay-url";

/**
 * NIP-11: Relay Information Document
 * https://github.com/nostr-protocol/nips/blob/master/11.md
 */

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch relay information document
 * NIP-11 specifies: GET request with Accept: application/nostr+json header
 */
export async function fetchRelayInfo(
  wsUrl: string,
): Promise<RelayInformation | null> {
  try {
    // Normalize URL for consistency
    const normalizedUrl = normalizeRelayURL(wsUrl);

    // Convert ws:// or wss:// to https://
    const httpUrl = normalizedUrl.replace(/^ws(s)?:/, "https:");

    const response = await fetch(httpUrl, {
      headers: { Accept: "application/nostr+json" },
    });

    if (!response.ok) return null;

    return (await response.json()) as RelayInformation;
  } catch (error) {
    console.warn(`NIP-11: Failed to fetch ${wsUrl}:`, error);
    return null;
  }
}

/**
 * Get relay information with caching (fetches if needed)
 */
export async function getRelayInfo(
  wsUrl: string,
): Promise<RelayInformation | null> {
  try {
    const normalizedUrl = normalizeRelayURL(wsUrl);
    const cached = await db.relayInfo.get(normalizedUrl);
    const isExpired = !cached || Date.now() - cached.fetchedAt > CACHE_DURATION;

    if (!isExpired) return cached.info;

    const info = await fetchRelayInfo(normalizedUrl);
    if (info) {
      await db.relayInfo.put({
        url: normalizedUrl,
        info,
        fetchedAt: Date.now(),
      });
    }

    return info;
  } catch (error) {
    console.warn(`NIP-11: Failed to get relay info for ${wsUrl}:`, error);
    return null;
  }
}

/**
 * Get cached relay info only (no network request)
 */
export async function getCachedRelayInfo(
  wsUrl: string,
): Promise<RelayInformation | null> {
  try {
    const normalizedUrl = normalizeRelayURL(wsUrl);
    const cached = await db.relayInfo.get(normalizedUrl);
    return cached?.info ?? null;
  } catch (error) {
    console.warn(
      `NIP-11: Failed to get cached relay info for ${wsUrl}:`,
      error,
    );
    return null;
  }
}

/**
 * Fetch multiple relays in parallel
 */
export async function getRelayInfoBatch(
  wsUrls: string[],
): Promise<Map<string, RelayInformation>> {
  const results = new Map<string, RelayInformation>();

  // Normalize URLs first
  const normalizedUrls = wsUrls
    .map((url) => {
      try {
        return normalizeRelayURL(url);
      } catch {
        return null;
      }
    })
    .filter((url): url is string => url !== null);

  const infos = await Promise.all(
    normalizedUrls.map((url) => getRelayInfo(url)),
  );

  infos.forEach((info, i) => {
    if (info) results.set(normalizedUrls[i], info);
  });

  return results;
}

/**
 * Clear relay info cache
 */
export async function clearRelayInfoCache(wsUrl?: string): Promise<void> {
  if (wsUrl) {
    try {
      const normalizedUrl = normalizeRelayURL(wsUrl);
      await db.relayInfo.delete(normalizedUrl);
    } catch (error) {
      console.warn(`NIP-11: Failed to clear cache for ${wsUrl}:`, error);
    }
  } else {
    await db.relayInfo.clear();
  }
}

/**
 * Check if relay supports a specific NIP
 */
export async function relaySupportsNip(
  wsUrl: string,
  nipNumber: number,
): Promise<boolean> {
  try {
    const normalizedUrl = normalizeRelayURL(wsUrl);
    const info = await getRelayInfo(normalizedUrl);
    return info?.supported_nips?.includes(nipNumber) ?? false;
  } catch (error) {
    console.warn(`NIP-11: Failed to check NIP support for ${wsUrl}:`, error);
    return false;
  }
}
