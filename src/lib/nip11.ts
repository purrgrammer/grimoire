import { RelayInformation } from "../types/nip11";
import db from "../services/db";

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
    // Convert ws:// or wss:// to https://
    const httpUrl = wsUrl.replace(/^ws(s)?:/, "https:");

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
  const cached = await db.relayInfo.get(wsUrl);
  const isExpired = !cached || Date.now() - cached.fetchedAt > CACHE_DURATION;

  if (!isExpired) return cached.info;

  const info = await fetchRelayInfo(wsUrl);
  if (info) {
    await db.relayInfo.put({ url: wsUrl, info, fetchedAt: Date.now() });
  }

  return info;
}

/**
 * Get cached relay info only (no network request)
 */
export async function getCachedRelayInfo(
  wsUrl: string,
): Promise<RelayInformation | null> {
  const cached = await db.relayInfo.get(wsUrl);
  return cached?.info ?? null;
}

/**
 * Fetch multiple relays in parallel
 */
export async function getRelayInfoBatch(
  wsUrls: string[],
): Promise<Map<string, RelayInformation>> {
  const results = new Map<string, RelayInformation>();
  const infos = await Promise.all(wsUrls.map((url) => getRelayInfo(url)));

  infos.forEach((info, i) => {
    if (info) results.set(wsUrls[i], info);
  });

  return results;
}

/**
 * Clear relay info cache
 */
export async function clearRelayInfoCache(wsUrl?: string): Promise<void> {
  if (wsUrl) {
    await db.relayInfo.delete(wsUrl);
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
  const info = await getRelayInfo(wsUrl);
  return info?.supported_nips?.includes(nipNumber) ?? false;
}
