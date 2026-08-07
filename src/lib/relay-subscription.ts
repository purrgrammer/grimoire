import { firstValueFrom, Observable } from "rxjs";
import { toArray } from "rxjs/operators";
import type { Filter, NostrEvent } from "nostr-tools";
import type {
  GroupRequestOptions,
  RelayPool,
  RelayReqOptions,
} from "applesauce-relay";
import { normalizeURL } from "applesauce-core/helpers";
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
 * not stall the batch — with a timeout backstop for relays that go silent.
 *
 * Unlike `pool.subscription()`, `pool.req()` does not deduplicate across
 * relays, so events are deduped by id here.
 */
export function streamWithEose(
  relays: string[],
  filters: Filter[],
  options?: {
    pool?: RelayPool;
    store?: typeof defaultEventStore | null;
    onEose?: () => void;
    /** Backstop for relays that connect but never EOSE. Default 15s. */
    eoseTimeout?: number;
    /** Reopen after a clean CLOSED. Defaults to true for long-lived streams. */
    resubscribe?: RelayReqOptions["resubscribe"];
    /** Retry connection errors. */
    reconnect?: RelayReqOptions["reconnect"];
  },
): Observable<NostrEvent> {
  const {
    pool = defaultPool,
    store = defaultEventStore,
    onEose,
    eoseTimeout = 15_000,
    resubscribe = true,
    reconnect = 5,
  } = options ?? {};

  // `message.from` is the relay's normalized URL, so normalize (and dedupe)
  // the expected set or the settled-count comparison can never be satisfied.
  const expected = new Set(relays.map((url) => normalizeURL(url)));
  const targets = [...expected];

  return new Observable<NostrEvent>((subscriber) => {
    if (targets.length === 0) {
      onEose?.();
      subscriber.complete();
      return;
    }

    const settled = new Set<string>();
    const seen = new Set<string>();
    let eoseEmitted = false;

    const emitEose = () => {
      if (eoseEmitted) return;
      eoseEmitted = true;
      clearTimeout(timer);
      onEose?.();
    };

    const timer = setTimeout(emitEose, eoseTimeout);

    const sub = pool
      .req(targets, filters, { resubscribe, reconnect })
      .subscribe({
        next: (message) => {
          switch (message.type) {
            case "EVENT":
              // Store every copy before deduping: each relay stamps its own
              // seen-relay symbol, and EventStore.add merges those onto the
              // retained event. Skipping duplicates here would leave every
              // event looking like it came from one relay, thinning the relay
              // hints built from getSeenRelays().
              try {
                store?.add(message.event);
              } catch (error) {
                console.error("[relay] failed to store event:", error);
              }

              // ...but only emit once per event; pool.req() delivers one copy
              // per relay, unlike pool.subscription().
              if (seen.has(message.event.id)) break;
              seen.add(message.event.id);
              subscriber.next(message.event);
              break;
            case "EOSE":
            case "CLOSED":
            case "ERROR":
              settled.add(message.from);
              if (settled.size >= expected.size) emitEose();
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
