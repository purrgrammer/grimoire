import { Observable } from "rxjs";
import type { Filter, NostrEvent } from "nostr-tools";
import type { GroupReqOptions, RelayPool } from "applesauce-relay";
import defaultPool from "@/services/relay-pool";
import defaultEventStore from "@/services/event-store";

/**
 * Options for {@link subscriptionWithEose}.
 */
export type SubscriptionWithEoseOptions = GroupReqOptions & {
  /**
   * How long to wait, in ms, before signalling EOSE even though some relays
   * have not sent one. Relays that accept a REQ and then stay silent would
   * otherwise stall the initial load forever. Default 8000.
   */
  eoseTimeout?: number;
  /**
   * Pool to subscribe through. Defaults to the app singleton; pass an explicit
   * pool for isolated flows (e.g. the scroll runtime's private pool).
   */
  pool?: RelayPool;
  /**
   * Where to put received events. Defaults to the app EventStore. Pass `null`
   * to keep events out of the shared store — isolated callers rely on that.
   */
  store?: typeof defaultEventStore | null;
};

/**
 * A pool subscription that still signals end-of-stored-events.
 *
 * applesauce v6 changed `RelayPool.subscription()` to emit only `NostrEvent` —
 * the v5 virtual `"EOSE"` string is gone, and `Relay.eoseTimeout` was removed
 * with it. Callers that gated their initial render on that string silently
 * stopped rendering, because `typeof response === "string"` is now never true
 * (and is not a type error, so the compiler can't flag it).
 *
 * This restores the `NostrEvent | "EOSE"` shape on top of v6's structured
 * `pool.req()` messages:
 *
 * - `EVENT` messages are added to the shared EventStore (which dedupes and
 *   handles replaceables) and re-emitted as plain events.
 * - `"EOSE"` is emitted exactly once, when every relay has settled — sent an
 *   EOSE, closed the subscription, or errored. Counting CLOSED and ERROR as
 *   settled matters: a relay that rejects the REQ outright (`restricted: this
 *   relay does not accept REQs`) never sends an EOSE, and must not be able to
 *   stall the batch.
 * - If some relays never settle, `"EOSE"` is emitted after `eoseTimeout`.
 *
 * The subscription stays open for live events after EOSE, as before.
 */
export function subscriptionWithEose(
  relays: string[],
  filters: Filter[],
  options?: SubscriptionWithEoseOptions,
): Observable<NostrEvent | "EOSE"> {
  const {
    eoseTimeout = 8000,
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

    // Safety net: never let a silent relay stall the initial batch.
    const timer = setTimeout(emitEose, eoseTimeout);

    const sub = pool.req(relays, filters, reqOptions).subscribe({
      next: (message) => {
        switch (message.type) {
          case "EVENT":
            store?.add(message.event);
            subscriber.next(message.event);
            break;

          // A relay is "settled" once it can produce no more stored events —
          // whether it finished normally, closed, or failed.
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
        // The stream ended, so nothing further is coming — make sure callers
        // waiting on EOSE are released rather than left hanging.
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
