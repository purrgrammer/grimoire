import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { RelayInformation } from "../types/nip11";
import { fetchRelayInfo } from "../lib/nip11";
import db from "../services/db";

/**
 * React hook to fetch and cache relay information (NIP-11)
 * @param wsUrl - WebSocket URL of the relay (ws:// or wss://)
 * @returns Relay information or undefined if not yet loaded
 */
export function useRelayInfo(wsUrl: string | undefined): RelayInformation | undefined {
  const cached = useLiveQuery(
    () => (wsUrl ? db.relayInfo.get(wsUrl) : undefined),
    [wsUrl],
  );

  useEffect(() => {
    if (!wsUrl) return;
    if (cached) return;

    // Fetch relay info if not in cache
    fetchRelayInfo(wsUrl).then((info) => {
      if (info) {
        db.relayInfo.put({
          url: wsUrl,
          info,
          fetchedAt: Date.now(),
        });
      }
    });
  }, [cached, wsUrl]);

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
