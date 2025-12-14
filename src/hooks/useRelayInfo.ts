import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo } from "react";
import { RelayInformation } from "../types/nip11";
import { fetchRelayInfo } from "../lib/nip11";
import db from "../services/db";
import { normalizeRelayURL } from "../lib/relay-url";

/**
 * React hook to fetch and cache relay information (NIP-11)
 * @param wsUrl - WebSocket URL of the relay (ws:// or wss://)
 * @returns Relay information or undefined if not yet loaded
 */
export function useRelayInfo(
  wsUrl: string | undefined,
): RelayInformation | undefined {
  // Normalize URL once
  const normalizedUrl = useMemo(() => {
    if (!wsUrl) return undefined;
    try {
      return normalizeRelayURL(wsUrl);
    } catch (error) {
      console.warn(`useRelayInfo: Invalid relay URL ${wsUrl}:`, error);
      return undefined;
    }
  }, [wsUrl]);

  const cached = useLiveQuery(
    () => (normalizedUrl ? db.relayInfo.get(normalizedUrl) : undefined),
    [normalizedUrl],
  );

  useEffect(() => {
    if (!normalizedUrl) return;
    if (cached) return;

    // Fetch relay info if not in cache
    fetchRelayInfo(normalizedUrl).then((info) => {
      if (info) {
        db.relayInfo.put({
          url: normalizedUrl,
          info,
          fetchedAt: Date.now(),
        });
      }
    });
  }, [cached, normalizedUrl]);

  return cached?.info;
}

/**
 * React hook to check if a relay supports a specific NIP
 * @param wsUrl - WebSocket URL of the relay
 * @param nipNumber - NIP number to check (e.g., 42 for NIP-42)
 * @returns true if supported, false if not, undefined if not yet loaded
 */
export function useRelaySupportsNip(
  wsUrl: string | undefined,
  nipNumber: number,
): boolean | undefined {
  const info = useRelayInfo(wsUrl);

  if (!info) return undefined;
  return info.supported_nips?.includes(nipNumber) ?? false;
}
