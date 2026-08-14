/**
 * The ONE door every Concord plane read goes through.
 *
 * A plane REQ is `{kinds:[1059], authors:[<derived stream pubkeys>]}` — authored
 * by keys the client derived, never by the user. That makes it unlike every
 * other read in grimoire, in two ways that both bite:
 *
 * 1. **`waitForAuth` must be off.** applesauce holds a REQ until the relay
 *    reports the USER authenticated, and re-authenticates as the user when a
 *    REQ is refused. Neither ever satisfies a stream-authored filter. Left on,
 *    the read either deadlocks (`authenticated$` false) or resubscribes at
 *    round-trip speed — measured at ~17k REQ/s, which floods a third party's
 *    relay. Both failure modes are silent.
 * 2. **Refused must be distinguishable from empty.** `requestEvents()` swallows
 *    an `auth-required` CLOSED into an empty array, so the sweep cannot tell "no
 *    plane here" from "you may not read this plane" — and those call for
 *    opposite actions (advance the floor vs. re-auth and retry).
 *
 * So plane reads use `relay.req()` directly, where the CLOSED is a visible
 * message. Nothing here uses `requestEvents`/`pool.request`, and an eslint rule
 * keeps it that way.
 *
 * They also use Concord's OWN pool rather than grimoire's singleton — the
 * auth-required flag that opting out sets is per-`Relay`, so sharing a socket
 * leaks the refusal into unrelated reads. See `concord-relay-pool.ts`.
 */

import { firstValueFrom, Observable, timer } from "rxjs";
import { catchError, map, takeUntil, takeWhile, toArray } from "rxjs/operators";
import type { Filter, NostrEvent } from "nostr-tools";
import { AuthRequiredError, RelayClosedError } from "applesauce-relay";
import type { RelayPool } from "applesauce-relay";

import defaultPool from "@/services/concord-relay-pool";

/** How a plane read ended. */
export type PlaneReadOutcome =
  /** The relay sent EOSE. Whatever arrived is what it has — for this filter. */
  | "eose"
  /** CLOSED with an `auth-required:` prefix. The gate, not an empty plane. */
  | "refused"
  /** CLOSED for any other reason (rate limit, bad filter, shutting down). */
  | "closed"
  /** Nothing completed the stream in time. Not evidence of anything. */
  | "timeout"
  /** The socket failed. Also not evidence of anything. */
  | "error";

export interface PlaneReadResult {
  events: NostrEvent[];
  outcome: PlaneReadOutcome;
  /** CLOSED reason, when there was one — worth logging, never parsed for meaning. */
  reason?: string;
}

/**
 * Hard ceiling on one plane REQ.
 *
 * Generous on purpose (armada uses 25s): a multi-hop VPN over Tor on one bar of
 * 4G is a supported way to use this, and a tight timeout there reads as a dead
 * relay rather than a slow one. Enforced with `takeUntil`, not applesauce's
 * `timeout` option — that one is applied upstream of the EVENT filter, where the
 * synchronous OPEN message disarms it permanently.
 */
export const PLANE_REQUEST_TIMEOUT_MS = 25_000;

export interface PlaneRequestOptions {
  pool?: RelayPool;
  timeout?: number;
}

/**
 * Read one relay for one filter, reporting how the read ended.
 *
 * Never rejects: a dead relay is an ordinary condition here, and the sweep's
 * whole design is that it reports facts about itself rather than throwing.
 */
export async function planeRequest(
  relayUrl: string,
  filter: Filter,
  options: PlaneRequestOptions = {},
): Promise<PlaneReadResult> {
  const pool = options.pool ?? defaultPool;
  const bound = options.timeout ?? PLANE_REQUEST_TIMEOUT_MS;

  const events: NostrEvent[] = [];
  let outcome: PlaneReadOutcome = "timeout";
  let reason: string | undefined;

  const messages = pool.relay(relayUrl).req([filter], {
    // See the module docstring. Changing either of these reintroduces a
    // silent-failure mode that has already been measured.
    waitForAuth: false,
    resubscribe: false,
    reconnect: false,
  });

  await firstValueFrom(
    messages.pipe(
      // EOSE and CLOSED both END a plane read: this is a one-shot page, and a
      // relay that keeps streaming after EOSE has nothing to add to a paged
      // history walk.
      takeWhile(
        (message) => message.type !== "EOSE" && message.type !== "CLOSED",
        true,
      ),
      map((message) => {
        if (message.type === "EVENT") events.push(message.event);
        else if (message.type === "EOSE") outcome = "eose";
        else if (message.type === "CLOSED") {
          // Pinned by plane-request.test.ts: applesauce mostly does NOT reach
          // here — it THROWS a CLOSED rather than emitting one (see the
          // catchError below). This branch stands for the versions and paths
          // where it emits, because misreading a CLOSED as an empty plane is
          // the failure this whole module exists to prevent.
          reason = message.reason;
          outcome = message.reason?.startsWith("auth-required")
            ? "refused"
            : "closed";
        }
        return message;
      }),
      takeUntil(timer(bound)),
      toArray(),
      catchError((error) => {
        // The ACTUAL path a refusal takes. `relay.req()` surfaces a CLOSED as a
        // thrown `RelayClosedError`, with `AuthRequiredError` as the
        // auth-required subclass — so a classifier that only reads emitted
        // CLOSED messages sees every refusal as a generic failure, and a sweep
        // built on it cannot tell a gated plane from an absent one.
        if (error instanceof AuthRequiredError) outcome = "refused";
        else if (error instanceof RelayClosedError) outcome = "closed";
        else outcome = "error";
        reason = error instanceof Error ? error.message : String(error);
        return [[]];
      }),
    ),
    { defaultValue: [] },
  );

  return { events, outcome, ...(reason !== undefined ? { reason } : {}) };
}

/** What a standing plane subscription hands its caller. */
export type PlaneStreamMessage =
  | { type: "event"; event: NostrEvent }
  /** Stored history is exhausted; anything after this is a live arrival. */
  | { type: "eose" }
  /** The stream is over. Always the last message, whatever ended it. */
  | { type: "ended"; outcome: PlaneReadOutcome; reason?: string };

/**
 * The STANDING sibling of {@link planeRequest} — the wire's door.
 *
 * Same two disciplines, same reasons (see the module docstring): the auth gate
 * is opted out of, and a refusal must stay distinguishable from an empty plane.
 * The difference is that this one does not end at EOSE — EOSE is reported as a
 * boundary and the subscription keeps running, which is the entire point of a
 * live subscription.
 *
 * Never errors. applesauce THROWS a refused CLOSED rather than emitting it (an
 * empirical finding, pinned by `plane-request.test.ts`), so the classification
 * happens here and the caller sees one terminal `ended` message either way — a
 * loop that has to know applesauce's throw semantics to tell "refused" from
 * "the relay went away" is a loop that will get it wrong.
 *
 * `reconnect` and `resubscribe` stay off, exactly as in the one-shot. Healing is
 * the round loop's job, with backoff — applesauce's `resubscribe` retries a
 * CLOSED with no delay and no count, which measured ~17k REQ/s against a relay
 * that refuses.
 */
export function planeStream(
  relayUrl: string,
  filters: Filter[],
  options: PlaneRequestOptions = {},
): Observable<PlaneStreamMessage> {
  const pool = options.pool ?? defaultPool;

  return new Observable<PlaneStreamMessage>((subscriber) => {
    const messages = pool.relay(relayUrl).req(filters, {
      // See the module docstring. Changing any of these reintroduces a
      // silent-failure mode that has already been measured.
      waitForAuth: false,
      resubscribe: false,
      reconnect: false,
    });

    const inner = messages.subscribe({
      next: (message) => {
        if (message.type === "EVENT") {
          subscriber.next({ type: "event", event: message.event });
        } else if (message.type === "EOSE") {
          subscriber.next({ type: "eose" });
        } else if (message.type === "CLOSED") {
          subscriber.next({
            type: "ended",
            outcome: message.reason?.startsWith("auth-required")
              ? "refused"
              : "closed",
            ...(message.reason !== undefined ? { reason: message.reason } : {}),
          });
          subscriber.complete();
        }
      },
      error: (error: unknown) => {
        const outcome: PlaneReadOutcome =
          error instanceof AuthRequiredError
            ? "refused"
            : error instanceof RelayClosedError
              ? "closed"
              : "error";
        subscriber.next({
          type: "ended",
          outcome,
          reason: error instanceof Error ? error.message : String(error),
        });
        subscriber.complete();
      },
      complete: () => {
        subscriber.next({ type: "ended", outcome: "closed" });
        subscriber.complete();
      },
    });

    return () => inner.unsubscribe();
  });
}
