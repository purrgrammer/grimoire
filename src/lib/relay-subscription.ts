import { firstValueFrom, Observable } from "rxjs";
import { toArray } from "rxjs/operators";
import type { Filter, NostrEvent } from "nostr-tools";
import type { GroupRequestOptions, RelayPool } from "applesauce-relay";
import defaultPool from "@/services/relay-pool";
import defaultEventStore from "@/services/event-store";

export type RequestEventsOptions = GroupRequestOptions & {
  pool?: RelayPool;
};

/**
 * Fetch stored events and resolve once the relays are done.
 *
 * `pool.request()` completes on its own, so this needs no EOSE bookkeeping or
 * manual timeout. Use it for one-shot lookups; use `pool.subscription()` with
 * `{ eventStore }` for anything that should keep streaming.
 */
export async function requestEvents(
  relays: string[],
  filters: Filter[],
  options?: RequestEventsOptions,
): Promise<NostrEvent[]> {
  const { pool = defaultPool, ...requestOptions } = options ?? {};

  return firstValueFrom(
    pool
      .request(relays, filters, {
        eventStore: defaultEventStore,
        ...requestOptions,
      })
      .pipe(toArray()),
    { defaultValue: [] as NostrEvent[] },
  );
}

/** Fetch a single event, or null if no relay had it. */
export async function requestEvent(
  relays: string[],
  filter: Filter,
  options?: RequestEventsOptions,
): Promise<NostrEvent | null> {
  const events = await requestEvents(relays, [filter], options);
  return events[0] ?? null;
}

/**
 * Stream events and signal end-of-stored-events, for callers that genuinely
 * need the boundary (WASM scroll programs, REQ state tracking).
 *
 * v6 dropped the virtual `"EOSE"` string from pool subscriptions, so this reads
 * the structured `pool.req()` messages instead. A relay counts as settled on
 * EOSE, CLOSED or ERROR — one that rejects the REQ never sends EOSE and must
 * not stall the batch.
 */
export function streamWithEose(
  relays: string[],
  filters: Filter[],
  options?: {
    pool?: RelayPool;
    store?: typeof defaultEventStore | null;
    onEose?: () => void;
  },
): Observable<NostrEvent> {
  const {
    pool = defaultPool,
    store = defaultEventStore,
    onEose,
  } = options ?? {};

  return new Observable<NostrEvent>((subscriber) => {
    const settled = new Set<string>();
    let eoseEmitted = false;

    const emitEose = () => {
      if (eoseEmitted) return;
      eoseEmitted = true;
      onEose?.();
    };

    const sub = pool.req(relays, filters).subscribe({
      next: (message) => {
        switch (message.type) {
          case "EVENT":
            store?.add(message.event);
            subscriber.next(message.event);
            break;
          case "EOSE":
          case "CLOSED":
          case "ERROR":
            settled.add(message.from);
            if (relays.length === 0 || settled.size >= relays.length) {
              emitEose();
            }
            break;
          default:
            break;
        }
      },
      error: (error) => subscriber.error(error),
      complete: () => {
        emitEose();
        subscriber.complete();
      },
    });

    return () => sub.unsubscribe();
  });
}
