import { useEffect } from "react";
import { useEventStore, use$ } from "applesauce-react/hooks";
import type { Subscription } from "rxjs";
import accounts from "@/services/accounts";
import { useGrimoire } from "@/core/state";
import { addressLoader } from "@/services/loaders";
import { ACTIVE_USER_KINDS } from "@/services/replaceable-event-cache";
import type { RelayInfo } from "@/types/app";
import { normalizeRelayURL } from "@/lib/relay-url";
import { getServersFromEvent } from "@/services/blossom";
import type { NostrEvent } from "@/types/nostr";

/**
 * Hook that syncs active account with Grimoire state and fetches configured replaceable events
 * Automatically fetches and watches all kinds in ACTIVE_USER_KINDS
 */
export function useAccountSync() {
  const {
    setActiveAccount,
    setActiveAccountRelays,
    setActiveAccountBlossomServers,
  } = useGrimoire();
  const eventStore = useEventStore();

  // Watch active account from accounts service
  const activeAccount = use$(accounts.active$);

  // Sync active account pubkey to state
  useEffect(() => {
    setActiveAccount(activeAccount?.pubkey);
  }, [activeAccount?.pubkey, setActiveAccount]);

  // Fetch and watch all configured kinds for active user
  useEffect(() => {
    if (!activeAccount?.pubkey) {
      return;
    }

    const pubkey = activeAccount.pubkey;
    const subscriptions: Subscription[] = [];
    const lastEventIds = new Map<number, string>();

    // Subscribe to all configured kinds
    for (const kind of ACTIVE_USER_KINDS) {
      // Fetch from relays
      const fetchSub = addressLoader({
        kind,
        pubkey,
        identifier: "",
      }).subscribe();

      // Watch for updates in EventStore
      const storeSub = eventStore
        .replaceable(kind, pubkey, "")
        .subscribe((event: NostrEvent | undefined) => {
          if (!event) return;

          // Only process if this is a new event
          if (event.id === lastEventIds.get(kind)) return;
          lastEventIds.set(kind, event.id);

          // Handle specific kinds
          if (kind === 10002) {
            // Parse relay list (NIP-65)
            const relays = parseRelayList(event);
            setActiveAccountRelays(relays);
          } else if (kind === 10063) {
            // Parse blossom server list (BUD-03)
            const servers = getServersFromEvent(event);
            setActiveAccountBlossomServers(servers);
          }
          // Kind 3 (contacts) is auto-cached but doesn't need UI state updates
          // Kind 10030 (emoji list) is auto-cached but doesn't need UI state updates
        });

      subscriptions.push(fetchSub, storeSub);
    }

    return () => {
      subscriptions.forEach((sub) => sub.unsubscribe());
    };
  }, [
    activeAccount?.pubkey,
    eventStore,
    setActiveAccountRelays,
    setActiveAccountBlossomServers,
  ]);
}

/**
 * Parse relay list event (NIP-65 format)
 * Tag format: ["r", "relay-url", "read|write"]
 * If no marker, relay is used for both read and write
 */
function parseRelayList(event: NostrEvent): RelayInfo[] {
  const relays: RelayInfo[] = [];
  const seenUrls = new Set<string>();

  for (const tag of event.tags) {
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
          `Skipping invalid relay URL in kind:10002 event: ${tag[1]}`,
          error,
        );
      }
    }
  }

  return relays;
}
