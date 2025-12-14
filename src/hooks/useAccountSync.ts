import { useEffect } from "react";
import { useEventStore, useObservableMemo } from "applesauce-react/hooks";
import accounts from "@/services/accounts";
import { useGrimoire } from "@/core/state";
import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import { addressLoader } from "@/services/loaders";
import type { RelayInfo, UserRelays } from "@/types/app";
import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * Hook that syncs active account with Grimoire state and fetches relay lists
 */
export function useAccountSync() {
  const { setActiveAccount, setActiveAccountRelays } = useGrimoire();
  const eventStore = useEventStore();

  // Watch active account from accounts service
  const activeAccount = useObservableMemo(() => accounts.active$, []);

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

        // Parse inbox and outbox relays
        const inboxRelays = getInboxes(relayListEvent);
        const outboxRelays = getOutboxes(relayListEvent);

        // Get all relays from tags
        const allRelays: RelayInfo[] = [];
        const seenUrls = new Set<string>();

        for (const tag of relayListEvent.tags) {
          if (tag[0] === "r" && tag[1]) {
            try {
              const url = normalizeRelayURL(tag[1]);
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);

              const type = tag[2];
              allRelays.push({
                url,
                read: !type || type === "read",
                write: !type || type === "write",
              });
            } catch (error) {
              console.warn(
                `Skipping invalid relay URL in Kind 10002 event: ${tag[1]}`,
                error
              );
            }
          }
        }

        const relays: UserRelays = {
          inbox: inboxRelays
            .map((url) => {
              try {
                return { url: normalizeRelayURL(url), read: true, write: false };
              } catch {
                return null;
              }
            })
            .filter((r): r is RelayInfo => r !== null),
          outbox: outboxRelays
            .map((url) => {
              try {
                return { url: normalizeRelayURL(url), read: false, write: true };
              } catch {
                return null;
              }
            })
            .filter((r): r is RelayInfo => r !== null),
          all: allRelays,
        };

        setActiveAccountRelays(relays);
      });

    return () => {
      subscription.unsubscribe();
      storeSubscription.unsubscribe();
    };
  }, [activeAccount?.pubkey, eventStore]);
}
