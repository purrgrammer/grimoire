/**
 * The wire's change-notification bus — a doorbell, not a data channel.
 *
 * Ported from armada's `src/wire/bus.ts` (`bc19d1f`), narrowed to the Concord
 * scopes. Its shape is the whole point: every event the wire ingests lands in
 * Dexie FIRST, and the bus then names WHICH conversation changed so mounted
 * hooks re-read the store. The store stays the single source of truth, so a
 * missed ring costs a stale render until the next one — never a lost message.
 *
 * Scopes are plain strings:
 *
 * - `c2:<channelIdHex>` — a channel's rumor store changed
 * - `c2ctl:<communityIdHex>` — a community's decrypted control plane changed
 * - `c2park:<streamPk>` — a wrap arrived for a stream the wire holds no key
 *   for, and was parked; a holder of that key should drain it
 *
 * Emissions are coalesced, so a catch-up replay writing hundreds of rumors
 * produces one notification rather than hundreds of re-reads.
 */

export type WireScope = string;

/** A channel's rumor store changed. */
export const channelScope = (channelIdHex: string): WireScope =>
  `c2:${channelIdHex}`;

/** A community's control plane changed — re-fold. */
export const controlScope = (communityIdHex: string): WireScope =>
  `c2ctl:${communityIdHex}`;

/** A wrap for this stream address was parked, unopened. */
export const parkScope = (streamPk: string): WireScope => `c2park:${streamPk}`;

/**
 * A relay's round is live again — anything held back for want of a socket can
 * go now.
 *
 * The signal exists because sending bypasses applesauce's connection handling
 * (`concord-publish.ts`): a wrap goes out over `relay.multiplex()`, and on a
 * gating relay only the wire's own standing REQ has settled the stream AUTH
 * that makes it acceptable. So "the network is back" is not the condition to
 * drain a queue on — "this relay's round is answering" is.
 */
export const wireUpScope = (relayUrl: string): WireScope => `c2up:${relayUrl}`;

/** The prefix a listener filters on to hear every relay's revival. */
export const WIRE_UP_PREFIX = "c2up:";

type WireListener = (scopes: ReadonlySet<WireScope>) => void;

/** Coalescing window for scope flushes (ms). Armada's value. */
const FLUSH_MS = 50;

const listeners = new Set<WireListener>();
let pending = new Set<WireScope>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  if (pending.size === 0) return;
  const batch = pending;
  pending = new Set();
  for (const listener of listeners) {
    try {
      listener(batch);
    } catch {
      // A listener must never break the bus for the others: these are React
      // re-read triggers, and one throwing component would otherwise silence
      // live delivery everywhere else.
    }
  }
}

/** Announce that these conversations' stores changed. Coalesced. */
export function emitWireScopes(scopes: Iterable<WireScope>): void {
  for (const s of scopes) pending.add(s);
  if (pending.size > 0 && timer === undefined) {
    timer = setTimeout(flush, FLUSH_MS);
  }
}

/** Subscribe to store-change announcements. Returns an unsubscribe. */
export function onWireScopes(listener: WireListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to ONE scope.
 *
 * The common case by far — a mounted channel or community watches its own
 * scope — and doing the membership test here keeps every caller from
 * re-implementing it.
 */
export function onWireScope(
  scope: WireScope,
  listener: () => void,
): () => void {
  return onWireScopes((scopes) => {
    if (scopes.has(scope)) listener();
  });
}

/** Test seam: drop any pending batch and every listener. */
export function _resetWireBusForTests(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  pending = new Set();
  listeners.clear();
}
