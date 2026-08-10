/**
 * applesauce's `RelayPool` in the shape Kehto's shell requires.
 *
 * Split out of `napplet-host` so the EOSE handshake can be tested against a real
 * relay without constructing a shell bridge. That handshake is the whole reason
 * this is not simply `pool.subscription`:
 *
 * Kehto reads an `"EOSE"` sentinel off the observable — `createRelayPoolAdapter`
 * does `if (item === "EOSE") callback("EOSE")` — and its runtime turns that into
 * the napplet's `relay.eose`, behind a 15-second fallback timer for relays that
 * never send one. An applesauce v6 pool subscription emits `NostrEvent` only, so
 * handing it over raw means the sentinel branch never fires and *every* napplet
 * subscription gets its EOSE 15s late: events arrive at once, and anything gated
 * on the boundary sits on a spinner until the timer fires. Nothing type-errors,
 * because the observer is typed `(item: unknown) => void`.
 *
 * `{ eventStore }` is equally load-bearing: the v6 default is a throwaway
 * in-memory store, so omitting it silently drops events from the shared one.
 */

import type { Filter } from "nostr-tools";
import type { RelayPool } from "applesauce-relay";

import { streamWithEose } from "@/lib/relay-subscription";
import defaultPool from "./relay-pool";
import defaultEventStore from "./event-store";
import type { RelayPoolLike } from "./kehto";

export function createNappletRelayPool(options?: {
  pool?: RelayPool;
  eventStore?: typeof defaultEventStore;
}): RelayPoolLike {
  const pool = options?.pool ?? defaultPool;
  const eventStore = options?.eventStore ?? defaultEventStore;

  return {
    subscription: (relayUrls, filters) => ({
      subscribe: (observer: (item: unknown) => void) => {
        const sub = streamWithEose(relayUrls, filters as Filter[], {
          pool,
          store: eventStore,
          onEose: () => observer("EOSE"),
        }).subscribe((event) => observer(event));
        return { unsubscribe: () => sub.unsubscribe() };
      },
    }),
    publish: (relayUrls, event) =>
      pool.publish(relayUrls, event).then(() => undefined),
    request: (relayUrls, filters) =>
      pool.request(relayUrls, filters, { eventStore }),
  };
}
