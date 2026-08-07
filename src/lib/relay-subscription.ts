import { firstValueFrom, Observable, of, timer } from "rxjs";
import { catchError, take, takeUntil, tap, toArray } from "rxjs/operators";
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
 * Hard ceiling on a one-shot request.
 *
 * This is enforced with `takeUntil`, not the `timeout` option: applesauce
 * applies `timeout({ first })` upstream of its EVENT filter, and a relay emits
 * an OPEN message the instant the REQ is written, which satisfies `first` and
 * disarms the timeout permanently. A relay that connects and then answers
 * `auth-required` sends no EVENT, EOSE, CLOSED or ERROR, so nothing else ever
 * completes the stream.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Backoff before reopening a subscription the relay closed cleanly. */
const RESUBSCRIBE_DELAY_MS = 5_000;

/** Upper bound on the per-subscription dedupe set. */
const MAX_SEEN_IDS = 20_000;

/**
 * Fetch stored events and resolve once the relays are done.
 *
 * Use for one-shot lookups; use `pool.subscription()` with `{ eventStore }`
 * for anything that should keep streaming. Resolves with whatever arrived if
 * the relays never finish — see REQUEST_TIMEOUT_MS.
 */
export async function requestEvents(
  relays: string[],
  filters: Filter[],
  options?: RequestEventsOptions,
): Promise<NostrEvent[]> {
  const { pool = defaultPool, ...requestOptions } = options ?? {};

  // Collect as we go so a timeout still yields what did arrive.
  const collected: NostrEvent[] = [];

  return firstValueFrom(
    pool
      .request(relays, filters, {
        eventStore: defaultEventStore,
        ...requestOptions,
      })
      .pipe(
        takeUntil(timer(REQUEST_TIMEOUT_MS)),
        tap((event) => collected.push(event)),
        toArray(),
        catchError((error) => {
          console.warn("[relay] request did not complete cleanly:", error);
          return of(collected);
        }),
      ),
    { defaultValue: [] as NostrEvent[] },
  );
}

/**
 * Fetch a single event, or null if no relay had it.
 *
 * Returns on the first match rather than waiting for every relay to finish,
 * so a hit on a fast relay isn't held up by the slowest one.
 */
export async function requestEvent(
  relays: string[],
  filter: Filter,
  options?: RequestEventsOptions,
): Promise<NostrEvent | null> {
  const { pool = defaultPool, ...requestOptions } = options ?? {};

  return firstValueFrom(
    pool
      .request(relays, [filter], {
        eventStore: defaultEventStore,
        ...requestOptions,
      })
      .pipe(
        takeUntil(timer(REQUEST_TIMEOUT_MS)),
        take(1),
        catchError((error) => {
          console.warn("[relay] event request failed:", error);
          return of(null);
        }),
      ),
    { defaultValue: null },
  );
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
    /**
     * Reopen after a clean CLOSED. Defaults to reopening after a delay.
     * Never pass `true`: applesauce turns that into `repeat({ delay: of(null) })`,
     * a synchronous loop — measured at >20k REQ frames per second against a
     * relay that CLOSEs after EOSE.
     */
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
    resubscribe = { delay: RESUBSCRIBE_DELAY_MS },
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
    // Scoped to this subscription on purpose: deduping against the shared
    // EventStore would drop events it already holds from another source, and
    // those would never reach the caller.
    const seen = new Set<string>();
    let eoseEmitted = false;

    const emitEose = () => {
      if (eoseEmitted) return;
      eoseEmitted = true;
      clearTimeout(eoseTimer);
      onEose?.();
    };

    const eoseTimer = setTimeout(emitEose, eoseTimeout);

    const sub = pool
      .req(targets, filters, { resubscribe, reconnect })
      .subscribe({
        next: (message) => {
          switch (message.type) {
            case "EVENT": {
              // Mirrors what pool.subscription({ eventStore }) did via
              // mapEventsToStore: add every copy, emit the instance the store
              // retained, and drop what the store rejects.
              let event = message.event;

              if (store) {
                let retained: NostrEvent | null;
                try {
                  // Every relay's copy is added, not just the first: each
                  // carries its own seen-relay symbol and add() merges them
                  // onto the retained event. Deduping first would leave events
                  // looking like they came from one relay, thinning the relay
                  // hints built from getSeenRelays().
                  retained = store.add(event);
                } catch (error) {
                  console.error("[relay] failed to store event:", error);
                  retained = event;
                }

                // null means the store refused it (e.g. expired). Upstream
                // filtered these out, so don't emit them.
                if (retained === null) break;
                event = retained;
              }

              // Emit once per event; pool.req() delivers one copy per relay,
              // unlike pool.subscription().
              if (seen.has(event.id)) break;
              seen.add(event.id);
              // Bounded so a long-lived stream can't grow without limit. Sets
              // keep insertion order, so this evicts the oldest id.
              if (seen.size > MAX_SEEN_IDS) {
                seen.delete(seen.values().next().value as string);
              }
              subscriber.next(event);
              break;
            }
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
          clearTimeout(eoseTimer);
          subscriber.error(error);
        },
        complete: () => {
          emitEose();
          subscriber.complete();
        },
      });

    return () => {
      clearTimeout(eoseTimer);
      sub.unsubscribe();
    };
  });
}
