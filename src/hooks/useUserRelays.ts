import { useMemo } from "react";
import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";

/**
 * Fetches a user's NIP-65 relay list (kind 10002) and returns
 * parsed inbox (read) and outbox (write) relays.
 */
export function useUserRelays(pubkey: string | undefined) {
  const pointer = useMemo(
    () => (pubkey ? { kind: 10002, pubkey, identifier: "" } : undefined),
    [pubkey],
  );

  const relayListEvent = useNostrEvent(pointer);

  const outboxRelays = useMemo(() => {
    if (!relayListEvent) return undefined;
    const relays = getOutboxes(relayListEvent);
    return relays.length > 0 ? relays : undefined;
  }, [relayListEvent]);

  const inboxRelays = useMemo(() => {
    if (!relayListEvent) return undefined;
    const relays = getInboxes(relayListEvent);
    return relays.length > 0 ? relays : undefined;
  }, [relayListEvent]);

  return { inboxRelays, outboxRelays, relayListEvent };
}
