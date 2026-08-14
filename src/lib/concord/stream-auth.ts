/**
 * Concord stream-key NIP-42 authentication.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/streamAuth.ts`), adapted to
 * applesauce.
 *
 * Every Concord plane is kind-1059 traffic addressed to a DERIVED per-stream
 * pubkey (control, guestbook, per-channel, dissolved, rekey) — never the user's
 * own identity. A relay that gates kind 1059 behind NIP-42 requires every
 * `authors` entry in the REQ to be an authenticated pubkey on the connection,
 * and the user's login cannot satisfy that. The client holds the stream secret
 * keys, so it authenticates AS each stream: extra kind-22242 frames on the same
 * challenge, leaving the socket authenticated as the user AND every stream it
 * will query.
 *
 * A relay's challenge stays valid for the socket's lifetime, so a key
 * registered after the challenge still authenticates on the live socket.
 * Acks are the relay's own `OK`, tracked per relay, so sweeps can gate on
 * "these authors are authenticated here" instead of a settle timer.
 */

import { firstValueFrom } from "rxjs";
import type { Observable } from "rxjs";
import { finalizeEvent } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";

import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * A stream address the client can query, and the secret that authenticates it
 * if we hold one.
 *
 * `sk` is absent for an ADDRESS-ONLY registration. A split Control Plane's
 * `control_pk` is held by every member but its signing secret only by staff
 * (CORD-02 §2), so a regular member can never answer a challenge for it. The
 * address is still registered so the auth gate treats it as accounted for
 * rather than "not yet registered" and waits forever.
 */
export interface StreamKey {
  /** x-only pubkey hex — the stream address. */
  pk: string;
  sk?: Uint8Array;
}

interface StreamKeyEntry {
  sk?: Uint8Array;
  /**
   * Normalized relay URLs whose challenges this key signs; `undefined` means
   * unscoped — sign everywhere, the safe fallback for callers that don't know
   * their community's relays.
   */
  relays?: Set<string>;
}

const registry = new Map<string, StreamKeyEntry>();

type Listener = (added: string[]) => void;
const listeners = new Set<Listener>();

function normalizeScope(relays?: string[]): Set<string> | undefined {
  if (!relays) return undefined;
  const out = new Set<string>();
  for (const r of relays) {
    try {
      out.add(normalizeRelayURL(r));
    } catch {
      // A malformed entry is skipped, never scoped.
    }
  }
  // An empty or garbage list must not scope a key to NOWHERE — fall back to
  // unscoped so the stream can still authenticate.
  return out.size > 0 ? out : undefined;
}

/**
 * Register stream keys (idempotent), scoped to the relays their community
 * lives on. Returns the pubkeys newly added or whose scope WIDENED, so a
 * caller can re-auth only when a challenged socket might be missing coverage.
 *
 * Scopes only ever widen: re-registering with fewer relays never narrows an
 * existing key, and an address-only entry gains a secret if one later arrives.
 */
export function registerStreamKeys(
  keys: StreamKey[],
  relays?: string[],
): string[] {
  const scope = normalizeScope(relays);
  const changed: string[] = [];
  for (const k of keys) {
    const existing = registry.get(k.pk);
    if (!existing) {
      registry.set(k.pk, {
        sk: k.sk,
        relays: scope ? new Set(scope) : undefined,
      });
      changed.push(k.pk);
      continue;
    }
    if (existing.sk === undefined && k.sk !== undefined) {
      // Report it: `changed` is what fires the listeners that re-sign AUTH
      // frames. A key that gains its secret on a live socket and is NOT
      // announced never gets a 22242 sent for it, so every REQ authored by
      // that address stays refused until the socket reopens — and the symptom
      // is an empty plane, not an error.
      existing.sk = k.sk;
      changed.push(k.pk);
      // No `continue`: the same call may also widen the relay scope, and
      // skipping that would lose coverage. A pubkey appearing twice in
      // `changed` is harmless — at worst a listener re-signs for it.
    }
    if (!existing.relays) continue; // already unscoped — broadest possible
    if (!scope) {
      existing.relays = undefined;
      changed.push(k.pk);
      continue;
    }
    let widened = false;
    for (const r of scope) {
      if (!existing.relays.has(r)) {
        existing.relays.add(r);
        widened = true;
      }
    }
    if (widened) changed.push(k.pk);
  }
  if (changed.length > 0) for (const l of listeners) l(changed);
  return changed;
}

/** Whether a pubkey is a known stream address. */
export function isStreamPubkey(pubkey: string): boolean {
  return registry.has(pubkey);
}

/** Whether we hold the secret to answer a challenge for this address. */
export function canSignAsStream(pubkey: string): boolean {
  return registry.get(pubkey)?.sk !== undefined;
}

/** Registered pubkeys whose scope covers `relayUrl` (unscoped keys always do). */
export function streamPubkeysForRelay(relayUrl: string): string[] {
  let normalized: string | undefined;
  try {
    normalized = normalizeRelayURL(relayUrl);
  } catch {
    normalized = undefined;
  }
  const out: string[] = [];
  for (const [pk, entry] of registry) {
    if (
      !entry.relays ||
      (normalized !== undefined && entry.relays.has(normalized))
    ) {
      out.push(pk);
    }
  }
  return out;
}

/** Subscribe to registry growth; fires with newly added or widened pubkeys. */
export function onStreamKeysAdded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Sign the NIP-42 events for the stream keys scoped to `relayUrl`. Signing is
 * local (raw secret keys), so this never touches the user's signer or bunker.
 * Address-only entries are skipped — there is nothing to sign with.
 */
export function signStreamAuths(
  challenge: string,
  relayUrl: string,
  pubkeys?: Iterable<string>,
): NostrEvent[] {
  const createdAt = Math.floor(Date.now() / 1000);
  const out: NostrEvent[] = [];
  for (const pk of pubkeys ?? streamPubkeysForRelay(relayUrl)) {
    const sk = registry.get(pk)?.sk;
    if (!sk) continue;
    out.push(
      finalizeEvent(
        {
          kind: 22242,
          content: "",
          tags: [
            ["relay", relayUrl],
            ["challenge", challenge],
          ],
          created_at: createdAt,
        },
        sk,
      ),
    );
  }
  return out;
}

/** Keys signed per event-loop turn by {@link signStreamAuthsChunked} (~4ms each). */
const SIGN_CHUNK = 16;

/**
 * {@link signStreamAuths}, yielded in chunks with an event-loop turn between
 * them. A Schnorr signature is ~4ms of main-thread work (5-10x that on a
 * phone) and a multi-community registry holds hundreds of keys, so signing a
 * whole challenge in one pass drops frames. Each chunk is valid the moment it
 * lands, so the caller sends as it goes and can stop if the challenge dies.
 */
export async function* signStreamAuthsChunked(
  challenge: string,
  relayUrl: string,
  pubkeys?: Iterable<string>,
): AsyncGenerator<NostrEvent[]> {
  const pks = [...(pubkeys ?? streamPubkeysForRelay(relayUrl))];
  for (let i = 0; i < pks.length; i += SIGN_CHUNK) {
    if (i > 0) await new Promise((r) => setTimeout(r, 0));
    yield signStreamAuths(challenge, relayUrl, pks.slice(i, i + SIGN_CHUNK));
  }
}

/** Test seam: forget every registered key and all per-relay ack state. */
export function _resetStreamAuthRegistry(): void {
  registry.clear();
  relayAuth.clear();
}

// ── Per-relay AUTH ack state ─────────────────────────────────────────────────

interface RelayAuthState {
  /** Whether this relay has issued a challenge on the live socket. */
  challenged: boolean;
  /** When the current challenge was recorded (ms) — for the stale self-heal. */
  challengedAt: number;
  /** Stream pubkeys the relay has acked on the live socket. */
  acked: Set<string>;
}

const relayAuth = new Map<string, RelayAuthState>();

/**
 * How long a challenged-but-unacked relay stays unsettled before the self-heal
 * fires. Longer than the sweep's auth-wait cap so a merely slow ack still wins;
 * past it we assume an AUTH frame or its OK was lost and stop blocking sync
 * forever, firing a re-auth so the relay recovers without an app restart.
 */
const AUTH_STALE_MS = 12_000;

type ReauthListener = (url: string) => void;
const reauthListeners = new Set<ReauthListener>();

/** Subscribe to auth-stale events for a relay whose stream AUTHs never acked. */
export function onStreamAuthStale(listener: ReauthListener): () => void {
  reauthListeners.add(listener);
  return () => reauthListeners.delete(listener);
}

function keyFor(url: string): string {
  try {
    return normalizeRelayURL(url);
  } catch {
    return url;
  }
}

function relayAuthState(url: string): RelayAuthState {
  const key = keyFor(url);
  let state = relayAuth.get(key);
  if (!state) {
    state = { challenged: false, challengedAt: 0, acked: new Set() };
    relayAuth.set(key, state);
  }
  return state;
}

/** Record that `url` issued a challenge on its live socket. */
export function noteRelayChallenged(url: string): void {
  const state = relayAuthState(url);
  state.challenged = true;
  state.challengedAt = Date.now();
}

/**
 * Whether this relay has issued a challenge on its live socket.
 *
 * The sweep's post-refusal gate needs this on its own: `streamAuthsSettled`
 * reports settled for a relay that never challenged, which is right for the
 * "should I hold this REQ" question and wrong for "has the gate been answered
 * yet" — the second one is asked only after a refusal has already proved the
 * relay gates.
 */
export function relayHasChallenged(url: string): boolean {
  return relayAuth.get(keyFor(url))?.challenged === true;
}

/** Reset a relay's auth state — a reopened socket is a fresh session. */
export function resetRelayAuth(url: string): void {
  relayAuth.delete(keyFor(url));
}

/** Record a relay's `OK` for a stream AUTH we sent. */
export function noteStreamAuthResult(
  url: string,
  pubkey: string,
  ok: boolean,
): void {
  if (!ok) return;
  relayAuthState(url).acked.add(pubkey);
}

/**
 * Whether a REQ authored by `pubkeys` would pass `url`'s NIP-42 gate now:
 * either the relay never challenged this socket (not gating, or its lazy
 * challenge hasn't fired and the REQ itself will trigger it), or every pubkey
 * we CAN authenticate as has been acked.
 *
 * Address-only entries — REGISTERED but secretless, i.e. a split Control
 * Plane's `control_pk` — are excluded from the requirement. There is no secret
 * to answer their challenge with, so waiting on them would block forever;
 * whether the relay serves such a REQ is the relay's call, not something we can
 * gate on.
 *
 * A pubkey that is not in the registry AT ALL is a different case and must
 * still be waited on: it is a key whose registration has not landed yet, and
 * skipping it reports settled for a REQ that will simply be refused, with no
 * gate left to retry behind.
 *
 * SELF-HEAL: past {@link AUTH_STALE_MS} an unacked key means a frame or its OK
 * was lost. Stop reporting unsettled and fire a re-auth, re-arming the window so
 * one detection triggers one wave rather than a storm.
 */
export function streamAuthsSettled(
  url: string,
  pubkeys: Iterable<string>,
): boolean {
  const state = relayAuth.get(keyFor(url));
  if (!state?.challenged) return true;
  let allAcked = true;
  for (const pk of pubkeys) {
    const entry = registry.get(pk);
    if (entry !== undefined && entry.sk === undefined) continue;
    if (!state.acked.has(pk)) {
      allAcked = false;
      break;
    }
  }
  if (allAcked) return true;
  if (Date.now() - state.challengedAt < AUTH_STALE_MS) return false;
  state.challengedAt = Date.now();
  const key = keyFor(url);
  for (const l of reauthListeners) l(key);
  return true;
}

// ── Sending the frames ───────────────────────────────────────────────────────

/**
 * The relay surface this needs. Structural rather than applesauce's `Relay`
 * class so a test can hand in a stub, and so the one method that matters is
 * stated outright.
 */
export interface AuthableRelay {
  url: string;
  challenge: string | null;
  /**
   * Send a raw frame and resolve with the relay's `OK`.
   *
   * NOTE the verb, and do NOT reach for `relay.auth()` instead. Applesauce
   * models NIP-42 as ONE identity per socket: `auth()` calls
   * `authentication$.next(event)`, so every stream frame would overwrite the
   * relay's record of who it is authenticated as — leaving `authenticatedAs$`
   * reporting a derived stream address, and `relay-auth-manager` reading
   * `authenticated$` as proof the USER authenticated when they never did.
   * `event(evt, "AUTH")` sends the same frame and returns the same `OK`
   * without touching that state.
   */
  event(
    event: NostrEvent,
    verb: "AUTH",
  ): Observable<{ ok: boolean; message?: string }>;
}

/**
 * Authenticate as every stream key scoped to `relay` against its live
 * challenge. Resolves with the pubkeys the relay acked.
 *
 * Sends chunked so a large registry doesn't block frames, and records each ack
 * as it lands so {@link streamAuthsSettled} can gate a REQ on the relay's own
 * answer rather than a timer.
 */
export async function authenticateStreams(
  relay: AuthableRelay,
  pubkeys?: Iterable<string>,
): Promise<string[]> {
  const challenge = relay.challenge;
  if (!challenge) return [];
  noteRelayChallenged(relay.url);

  const acked: string[] = [];
  for await (const chunk of signStreamAuthsChunked(
    challenge,
    relay.url,
    pubkeys,
  )) {
    const results = await Promise.all(
      chunk.map(async (event) => {
        try {
          const res = await firstValueFrom(relay.event(event, "AUTH"));
          return { pubkey: event.pubkey, ok: res.ok };
        } catch {
          return { pubkey: event.pubkey, ok: false };
        }
      }),
    );
    for (const { pubkey, ok } of results) {
      noteStreamAuthResult(relay.url, pubkey, ok);
      if (ok) acked.push(pubkey);
    }
  }
  return acked;
}
