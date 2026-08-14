/**
 * Publishing a Concord wrap: first ack wins.
 *
 * Three things make this unlike every other publish in grimoire, and all three
 * are the same reasons plane READS needed their own door.
 *
 * **1. It goes through Concord's own pool.** The wrap is authored by a derived
 * stream key, and on a relay that gates kind 1059 the only thing that can
 * satisfy the write is the stream AUTH — which lands on the Concord pool's
 * sockets and nowhere else. Publishing through `publishService` would offer the
 * user's identity to a filter that can never accept it.
 *
 * **2. It does NOT use `relay.event()`, and that is not a style choice.**
 * applesauce wraps every non-AUTH `event()` in
 * `waitForAuth(authRequiredForPublish$, …)`. One `auth-required` OK arms
 * `receivedAuthRequiredForEvent`, and from then on EVERY publish on that `Relay`
 * hangs until `authenticated$` turns true — which reflects the USER's NIP-42
 * state and is never set here, because Concord authenticates as the STREAM. The
 * flag only clears when the socket reopens, and the wire deliberately keeps that
 * socket open, so a single early refusal wedges sending for the session.
 *
 * Measured, not reasoned: with the refusal first, the second publish's EVENT
 * frame never reached the relay at all. Reverse the order — authenticate, then
 * publish — and it is accepted. This is the exact publish-side twin of the REQ
 * wedge phase 0 found, and it is why `plane-request.ts` exists.
 *
 * So the frame goes out through `relay.multiplex()`, which sends on subscribe,
 * connects the socket, and hands back the matching OK — no auth gate in the
 * path. Armada reaches for the raw socket in the same spot and for the same
 * reason.
 *
 * The cost, and it is a real coupling rather than an aside: `multiplex()`
 * bypasses applesauce's watchTower, which is the only thing that populates
 * `challenge$`. On a socket NOTHING ELSE has opened, no challenge is ever
 * observed, `concord-stream-auth.ts` never answers one, and a gating relay
 * refuses every send with "still authenticating" forever. In practice the wire
 * holds a standing REQ on every community relay and sending requires a Concord
 * window — which is what starts the wire — so the socket is always live by the
 * time anyone can type. Anything that sends OUTSIDE that arrangement has to
 * open a plane read first.
 *
 * **3. First ack wins, not all acks.** A member's relay set is routinely three
 * relays where one is dead, and holding a send open on the dead one is exactly
 * what makes a chat client feel broken.
 */

import { firstValueFrom, timer } from "rxjs";
import { map, take, timeout } from "rxjs/operators";
import type { NostrEvent } from "nostr-tools";

import concordPool from "@/services/concord-relay-pool";

/** How long to wait for the first accepting relay. */
export const PUBLISH_TIMEOUT_MS = 15_000;

export interface PublishOutcome {
  /** Relays that said OK. */
  accepted: string[];
  /** Relays that refused or never answered, with what they said. */
  rejected: Array<{ relay: string; reason: string }>;
}

/** One relay's answer for one wrap, or a throw if it never gave one. */
function publishToRelay(
  url: string,
  wrap: NostrEvent,
  timeoutMs: number,
): Promise<{ ok: boolean; message: string }> {
  return firstValueFrom(
    concordPool
      .relay(url)
      .multiplex(
        () => ["EVENT", wrap],
        // Unsubscribe has nothing to say about an EVENT — there is no
        // subscription to close — but rxjs's multiplex insists on a message. A
        // CLOSE naming a sub id that was never opened is well-formed and
        // ignored by every relay, which is the quietest thing to send.
        () => ["CLOSE", `concord-publish-${wrap.id.slice(0, 16)}`],
        (message: unknown) =>
          Array.isArray(message) &&
          message[0] === "OK" &&
          message[1] === wrap.id,
      )
      .pipe(
        take(1),
        map((message) => ({
          ok: Boolean((message as unknown[])[2]),
          message: String((message as unknown[])[3] ?? ""),
        })),
        timeout({ first: timeoutMs }),
      ),
  );
}

/**
 * Broadcast to every relay, resolving as soon as ONE accepts.
 *
 * Rejects only when every relay has answered and none accepted, or when nothing
 * accepted inside the timeout. The remaining publishes are left running: a relay
 * that acks late still got the message, and cancelling them would throw away
 * deliveries that already succeeded.
 */
export async function publishWrap(
  relays: string[],
  wrap: NostrEvent,
  timeoutMs: number = PUBLISH_TIMEOUT_MS,
): Promise<PublishOutcome> {
  if (relays.length === 0) {
    throw new Error("This community lists no relays to send to.");
  }

  const accepted: string[] = [];
  const rejected: Array<{ relay: string; reason: string }> = [];
  let settled = 0;

  const firstAck = new Promise<void>((resolve, reject) => {
    const done = () => {
      settled += 1;
      if (accepted.length > 0) resolve();
      // Every relay has answered and none took it — say so now rather than
      // waiting out a timeout on a batch that is already finished.
      else if (settled === relays.length)
        reject(new Error(summarize(rejected)));
    };

    for (const url of relays) {
      void publishToRelay(url, wrap, timeoutMs)
        .then((response) => {
          if (response.ok) accepted.push(url);
          else rejected.push({ relay: url, reason: response.message });
        })
        .catch((error: unknown) => {
          rejected.push({
            relay: url,
            reason: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(done);
    }
  });

  await Promise.race([
    firstAck,
    firstValueFrom(timer(timeoutMs)).then(() => {
      if (accepted.length === 0) throw new Error(summarize(rejected));
    }),
  ]);

  return { accepted, rejected };
}

/** A refusal a user can act on, rather than a stack trace. */
function summarize(rejected: Array<{ relay: string; reason: string }>): string {
  const authGated = rejected.find((r) =>
    r.reason.toLowerCase().includes("auth-required"),
  );
  if (authGated) {
    return "The relay would not accept the message — this community's relay is still authenticating. Try again in a moment.";
  }
  const spoken = rejected.find((r) => r.reason.trim().length > 0);
  return spoken
    ? `No relay accepted the message: ${spoken.reason}`
    : "No relay accepted the message.";
}
