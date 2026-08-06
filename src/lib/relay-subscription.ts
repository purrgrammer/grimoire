import { Observable } from "rxjs";
import type { Filter, NostrEvent } from "nostr-tools";
import type { GroupReqOptions, RelayPool } from "applesauce-relay";
import defaultPool from "@/services/relay-pool";
import defaultEventStore from "@/services/event-store";

export type SubscriptionWithEoseOptions = GroupReqOptions & {
  /** Backstop for relays that never send EOSE. Default 20s. */
  eoseTimeout?: number;
  /** Pool to subscribe through. Defaults to the app singleton. */
  pool?: RelayPool;
  /** Where to put events. `null` keeps them out of the shared store. */
  store?: typeof defaultEventStore | null;
};

/**
 * A pool subscription that still signals end-of-stored-events, which
 * applesauce v6 dropped. See "applesauce v6 relay gotchas" in CLAUDE.md.
 *
 * Emits `"EOSE"` once, when every relay has settled (EOSE, CLOSED or ERROR)
 * or the timeout fires. Stays open for live events afterwards.
 */
export function subscriptionWithEose(
  relays: string[],
  filters: Filter[],
  options?: SubscriptionWithEoseOptions,
): Observable<NostrEvent | "EOSE"> {
  const {
    eoseTimeout = 20_000,
    pool = defaultPool,
    store = defaultEventStore,
    ...reqOptions
  } = options ?? {};

  return new Observable<NostrEvent | "EOSE">((subscriber) => {
    const settled = new Set<string>();
    const expected = new Set(relays);
    let eoseEmitted = false;

    const emitEose = () => {
      if (eoseEmitted) return;
      eoseEmitted = true;
      clearTimeout(timer);
      subscriber.next("EOSE");
    };

    const timer = setTimeout(emitEose, eoseTimeout);

    const sub = pool.req(relays, filters, reqOptions).subscribe({
      next: (message) => {
        switch (message.type) {
          case "EVENT":
            store?.add(message.event);
            subscriber.next(message.event);
            break;

          // CLOSED and ERROR count as settled: a relay that rejects the REQ
          // never sends EOSE and must not stall the batch.
          case "EOSE":
          case "CLOSED":
          case "ERROR":
            settled.add(message.from);
            if (expected.size === 0 || settled.size >= expected.size) {
              emitEose();
            }
            break;

          default:
            break;
        }
      },
      error: (error) => {
        clearTimeout(timer);
        subscriber.error(error);
      },
      complete: () => {
        emitEose();
        subscriber.complete();
      },
    });

    return () => {
      clearTimeout(timer);
      sub.unsubscribe();
    };
  });
}
