/**
 * Wires the Concord stream-key registry to relay socket lifecycle.
 *
 * `stream-auth.ts` knows how to sign and track NIP-42 frames for derived stream
 * keys; nothing there decides WHEN to send them. This is that half.
 *
 * Four triggers, and each one exists because dropping it produces the same
 * silent symptom — a plane that reads empty forever:
 *
 * - **a challenge arrives** → authenticate every stream key scoped to that
 *   relay. On grimoire's pool a relay connects on its first REQ, so the opening
 *   plane REQ routinely races the challenge; the sweep's post-refusal retry is
 *   what catches up, and it is waiting on this.
 * - **the socket closes** → forget the acks. applesauce's `resetState()` runs
 *   on both open and close, clearing `challenge$` and every auth flag, while
 *   `relay-auth-manager` only ever re-authenticates the active USER. Without
 *   this the registry keeps a stale `acked` set, `streamAuthsSettled` keeps
 *   returning true, and every plane REQ after the first reconnect fails. This
 *   is the single most likely cause of a "communities stop loading after a
 *   while" bug.
 * - **new keys register** → re-authenticate on live challenged sockets. A
 *   relay's challenge stays valid for the socket's lifetime, so a key that
 *   arrives after the challenge can still answer it — but only if something
 *   sends the frame.
 * - **acks go stale** → re-send. A lost AUTH frame or a lost OK would otherwise
 *   wedge the relay until the app restarts.
 *
 * Only relays with keys scoped to them are ever touched, so this never signs a
 * 22242 at a relay that has nothing to do with Concord.
 */

import type { Relay } from "applesauce-relay";

import {
  authenticateStreams,
  onStreamAuthStale,
  onStreamKeysAdded,
  resetRelayAuth,
  streamPubkeysForRelay,
} from "@/lib/concord/stream-auth";
import { normalizeRelayURL } from "@/lib/relay-url";
// Concord's own pool, NOT the singleton: the plane sockets live there, so
// watching the shared pool would sign 22242s at relays nothing reads Concord
// from while the plane sockets sat unauthenticated. See `concord-relay-pool.ts`.
import pool from "@/services/concord-relay-pool";

function safeNormalize(url: string): string {
  try {
    return normalizeRelayURL(url);
  } catch {
    return url;
  }
}

/** Per-relay teardown for the subscriptions this module owns. */
const watched = new Map<string, () => void>();
let started = false;

/**
 * Authenticate as every stream key scoped to this relay, if it has a live
 * challenge and any keys to offer.
 *
 * Failures are swallowed: a relay that will not take our AUTH is a relay whose
 * planes we cannot read, which the sweep already reports as `refused`. Throwing
 * from a socket callback would take out unrelated reads.
 */
async function authenticate(relay: Relay): Promise<void> {
  if (!relay.challenge) return;
  if (streamPubkeysForRelay(relay.url).length === 0) return;
  try {
    await authenticateStreams(relay);
  } catch (error) {
    console.warn(`[concord] stream auth failed at ${relay.url}:`, error);
  }
}

function watch(relay: Relay): void {
  if (watched.has(relay.url)) return;

  const onChallenge = relay.challenge$.subscribe((challenge) => {
    if (challenge) void authenticate(relay);
  });
  // Reset on close, not on open: `resetState()` has already cleared the socket's
  // auth state by the time a new challenge arrives, and clearing on open would
  // race the challenge subscription above.
  const onClose = relay.close$.subscribe(() => resetRelayAuth(relay.url));

  watched.set(relay.url, () => {
    onChallenge.unsubscribe();
    onClose.unsubscribe();
  });
}

/**
 * Start watching the pool for Concord stream auth. Idempotent.
 *
 * Called from the first Concord read, like the derivation cache: a user who
 * never opens a community should not have subscriptions on every relay socket.
 */
export function startConcordStreamAuth(): void {
  if (started) return;
  started = true;

  for (const relay of pool.relays.values()) watch(relay);
  pool.add$.subscribe((relay) => watch(relay));
  pool.remove$.subscribe((relay) => {
    watched.get(relay.url)?.();
    watched.delete(relay.url);
    resetRelayAuth(relay.url);
  });

  // A key that gains its secret, or widens its relay scope, on a socket that is
  // already challenged: re-sign for exactly that key rather than the whole
  // registry.
  onStreamKeysAdded((added) => {
    for (const relay of pool.relays.values()) {
      if (!relay.challenge) continue;
      const scoped = new Set(streamPubkeysForRelay(relay.url));
      const mine = added.filter((pk) => scoped.has(pk));
      if (mine.length === 0) continue;
      void authenticateStreams(relay, mine).catch(() => undefined);
    }
  });

  onStreamAuthStale((url) => {
    // The stale event carries grimoire's normalized URL; the pool keys by
    // applesauce's. Compare through the same normalizer rather than assuming
    // the two spellings match, or the self-heal silently never fires.
    const target = safeNormalize(url);
    for (const relay of pool.relays.values()) {
      if (safeNormalize(relay.url) === target) void authenticate(relay);
    }
  });
}

/** Test seam: stop watching and forget which relays were wired. */
export function _resetConcordStreamAuthForTests(): void {
  for (const teardown of watched.values()) teardown();
  watched.clear();
  started = false;
}
