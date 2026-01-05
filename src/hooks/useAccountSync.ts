import { useEffect } from "react";
import { useEventStore, use$ } from "applesauce-react/hooks";
import accounts from "@/services/accounts";
import { useGrimoire } from "@/core/state";
import { addressLoader } from "@/services/loaders";
import type { RelayInfo } from "@/types/app";
import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * Hook that syncs active account with Grimoire state and fetches relay lists
 */
export function useAccountSync() {
  const { setActiveAccount, setActiveAccountRelays } = useGrimoire();
  const eventStore = useEventStore();

  // Watch active account from accounts service
  const activeAccount = use$(accounts.active$);

  // Sync active account pubkey to state
  useEffect(() => {
    setActiveAccount(activeAccount?.pubkey);
  }, [activeAccount?.pubkey, setActiveAccount]);

  // Fetch and watch relay list (kind 10002) when account changes
  useEffect(() => {
    if (!activeAccount?.pubkey) {
      return;
    }

    const pubkey = activeAccount.pubkey;
    let lastRelayEventId: string | undefined;

    // Subscribe to kind 10002 (relay list)
    const subscription = addressLoader({
      kind: 10002,
      pubkey,
      identifier: "",
    }).subscribe();

    // Watch for relay list event in store
    const storeSubscription = eventStore
      .replaceable(10002, pubkey, "")
      .subscribe((relayListEvent) => {
        if (!relayListEvent) return;

        // Only process if this is a new event
        if (relayListEvent.id === lastRelayEventId) return;
        lastRelayEventId = relayListEvent.id;

        // Parse relays from tags (NIP-65 format)
        // Tag format: ["r", "relay-url", "read|write"]
        // If no marker, relay is used for both read and write
        const relays: RelayInfo[] = [];
        const seenUrls = new Set<string>();

        for (const tag of relayListEvent.tags) {
          if (tag[0] === "r" && tag[1]) {
            try {
              const url = normalizeRelayURL(tag[1]);
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);

              const marker = tag[2];
              relays.push({
                url,
                read: !marker || marker === "read",
                write: !marker || marker === "write",
              });
            } catch (error) {
              console.warn(
                `Skipping invalid relay URL in Kind 10002 event: ${tag[1]}`,
                error,
              );
            }
          }
        }

        setActiveAccountRelays(relays);
      });

    return () => {
      subscription.unsubscribe();
      storeSubscription.unsubscribe();
    };
  }, [activeAccount?.pubkey, eventStore, setActiveAccountRelays]);
}
