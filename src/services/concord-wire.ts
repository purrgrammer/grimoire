/**
 * The wire: one standing REQ per relay, resumed from a persisted cursor.
 *
 * Ported from armada `bc19d1f` (`src/wire/WireSync.tsx`), narrowed to Concord
 * and re-expressed on applesauce. Before this, a channel was read by PULLING ON
 * OPEN — so the first open paid relay latency, nothing arrived while you were
 * looking elsewhere, and a message in another channel appeared only once you
 * navigated to it. Those are not tuning problems: there was no subscription.
 *
 * The shape: every event ingested lands in Dexie first, and the bus then names
 * which conversation changed so mounted hooks re-read. `syncChannel` keeps its
 * job — paging BACKWARDS through history — and this covers forward delivery.
 *
 * Everything here runs on Concord's own `RelayPool` (see
 * `concord-relay-pool.ts`), which is what makes a standing subscription to
 * auth-gated plane addresses safe to hold open at all.
 */

import {
  planeStream,
  type PlaneReadOutcome,
  type PlaneStreamMessage,
} from "@/lib/concord/plane-request";
import { whenAuthAnswered } from "@/lib/concord/plane-sync";
import { emitWireScopes, wireUpScope } from "@/lib/concord/wire-bus";
import { streamPubkeysForRelay } from "@/lib/concord/stream-auth";
import {
  subSignature,
  type WireSpec,
  type WireSub,
} from "@/lib/concord/wire-spec";
import concordPool from "@/services/concord-relay-pool";
import { startConcordStreamAuth } from "@/services/concord-stream-auth";
import {
  drainParkedWraps,
  ingestWireEvents,
} from "@/services/concord-wire-ingest";
import db from "@/services/db";
import type { Relay } from "applesauce-relay";
import type { Filter, NostrEvent } from "nostr-tools";
import type { Subscription } from "rxjs";

// ── Knobs (armada's constants, and its reasons) ──────────────────────────────

/**
 * How far back a relay with no cursor resumes. Short on purpose: this is a LIVE
 * subscription, and deeper history is `syncChannel`'s job.
 */
const FRESH_LOOKBACK_SECONDS = 5 * 60;
/**
 * Ceiling on a resumed cursor. A device off for a month resumes at a week, not
 * at the epoch — the rest backfills on demand.
 */
const MAX_CURSOR_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Overlap subtracted from a resumed cursor (clock skew, borderline events). */
const CURSOR_OVERLAP_SECONDS = 60;
/**
 * Watchdog on a FRESH round. A healthy relay answers with something almost
 * immediately — events, or at minimum EOSE, even after settling NIP-42. A round
 * that has yielded nothing by now was swallowed (a REQ held behind a wedged AUTH
 * exchange, a half-open socket) and is re-issued. Without it the subscription
 * silently dies until the app is relaunched.
 */
const SILENT_REQ_TIMEOUT_MS = 30_000;
/**
 * Rotation ceiling on a QUIET established round. A quiet channel and a
 * subscription that died without a CLOSED look identical from here, so never
 * trust one subscription for long. Rotation is lossless (the cursor plus its
 * overlap replays the boundary) and costs one REQ frame.
 */
const QUIET_ROTATE_MS = 90_000;
/** How often silence is re-checked. */
const WATCHDOG_TICK_MS = 5_000;
/**
 * Events buffered from a round's stored replay before being flushed as ONE
 * batch. Ingesting singly turns an N-event catch-up into N Dexie transactions
 * and N bus rings — armada's post-resume main-thread chug. Live arrivals (post
 * EOSE) still ingest immediately, because latency is the whole point there.
 */
const REPLAY_BATCH_MAX = 200;
/** Backoff floor and ceiling between rounds. */
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** A round that survived this long earns a prompt retry rather than a backoff. */
const HEALTHY_ROUND_MS = 60_000;

let knobs = {
  silentMs: SILENT_REQ_TIMEOUT_MS,
  quietMs: QUIET_ROTATE_MS,
  tickMs: WATCHDOG_TICK_MS,
  backoffMinMs: BACKOFF_MIN_MS,
  backoffMaxMs: BACKOFF_MAX_MS,
};

/** Test seam: run the watchdogs and backoff on a scale a test can wait out. */
export function _configureWireForTests(over: Partial<typeof knobs>): void {
  knobs = { ...knobs, ...over };
}

// ── Cursors ─────────────────────────────────────────────────────────────────
//
// One `since` cursor per relay, in `concordKv`, behind a synchronous cache. The
// first round WAITS for the cache: reading it unwarmed resumes from the fresh
// lookback and re-ingests the backlog on every launch.
//
// Note the asymmetry with the control sweep's delta floor, which is deliberately
// session-only. They are different things and must not be "consistency-fixed"
// into each other:
//
// - the sweep's floor gates a COMPLETE-mode re-read whose whole purpose is to
//   re-see editions BELOW the high-water mark, so persisting it starves the fold;
// - this cursor gates a live subscription, where persisting it only avoids
//   re-downloading what is already stored, and the sweep remains the
//   completeness backstop.

const CURSOR_PREFIX = "wire-cursor:";
const cursors = new Map<string, number>();
let cursorsLoaded: Promise<void> | undefined;

function loadCursors(): Promise<void> {
  cursorsLoaded ??= db.concordKv
    .where("key")
    .startsWith(CURSOR_PREFIX)
    .toArray()
    .then((rows) => {
      for (const row of rows) {
        if (typeof row.value === "number" && Number.isFinite(row.value)) {
          cursors.set(row.key.slice(CURSOR_PREFIX.length), row.value);
        }
      }
    })
    .catch(() => undefined);
  return cursorsLoaded;
}

function readCursor(relay: string): number | undefined {
  const n = cursors.get(relay);
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Advance a relay's cursor, CLAMPED to the local clock.
 *
 * Without the clamp one event stamped in the future — a member's skewed clock,
 * or a hostile timestamp — drags the cursor past `now`; every later REQ then
 * opens with `since > now` and the wire goes deaf on that relay. Permanently,
 * because the cursor is durable.
 */
function writeCursor(relay: string, createdAt: number): void {
  const next = Math.min(createdAt, Math.floor(Date.now() / 1000));
  const prev = readCursor(relay) ?? 0;
  if (next <= prev) return;
  cursors.set(relay, next);
  void db.concordKv
    .put({ key: `${CURSOR_PREFIX}${relay}`, value: next })
    .catch(() => undefined);
}

/** Test seam: forget every cursor, in memory and on disk. */
export async function _resetWireCursorsForTests(): Promise<void> {
  cursors.clear();
  cursorsLoaded = undefined;
  await db.concordKv.where("key").startsWith(CURSOR_PREFIX).delete();
}

// ── The round loop ──────────────────────────────────────────────────────────

interface RelayLoop {
  /** The filter signature this loop was started for. */
  sig: string;
  stop: () => void;
  /** Restart the round NOW, skipping any backoff. */
  bump: () => void;
}

interface RoundOutcome {
  /** Whether the relay said anything at all — an event, or an EOSE. */
  sawAnything: boolean;
  /** How the round ended, when the relay ended it. */
  outcome?: PlaneReadOutcome;
}

/**
 * Hold one REQ open until it ends, is aborted, or goes silent past a deadline.
 *
 * Resolves rather than rejects: every way this can end is an ordinary condition
 * the loop above decides what to do about.
 */
function runRound(
  relay: string,
  filters: Filter[],
  getSpec: () => WireSpec,
  abort: AbortSignal,
  /** Called the first time this round hears anything (see {@link watchSocketReopens}). */
  onEstablished?: () => void,
): Promise<RoundOutcome> {
  return new Promise<RoundOutcome>((resolve) => {
    const state: RoundOutcome = { sawAnything: false };
    const establish = () => {
      if (state.sawAnything) return;
      state.sawAnything = true;
      onEstablished?.();
    };
    let lastMessageAt = Date.now();
    let eosed = false;
    let replay: NostrEvent[] = [];
    let settled = false;
    // A holder rather than a bare binding: `finish` closes over it and can run
    // before `subscribe()` has returned, if the relay refuses synchronously.
    const held: { sub?: Subscription } = {};

    // The cursor advances ONLY over events the store accepted. It is durable, so
    // moving it past a write that failed skips those events on this relay
    // forever — but stalling it on an ordinary batch of duplicates would replay
    // the same window every round, which is why ingest reports "a write failed"
    // separately from "nothing was new".
    const flushReplay = async () => {
      if (replay.length === 0) return;
      const batch = replay;
      replay = [];
      const { failed } = await ingestWireEvents(getSpec(), batch);
      if (!failed) {
        writeCursor(relay, Math.max(...batch.map((e) => e.created_at)));
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      abort.removeEventListener("abort", onAbort);
      // A round torn down mid-replay still ingests what it already received.
      void flushReplay().finally(() => {
        held.sub?.unsubscribe();
        resolve(state);
      });
    };

    const onAbort = () => finish();
    const watchdog = setInterval(() => {
      const silentFor = Date.now() - lastMessageAt;
      if (!state.sawAnything && silentFor >= knobs.silentMs) finish();
      else if (state.sawAnything && silentFor >= knobs.quietMs) finish();
    }, knobs.tickMs);

    if (abort.aborted) return finish();
    abort.addEventListener("abort", onAbort);

    held.sub = planeStream(relay, filters, { pool: concordPool }).subscribe(
      (message: PlaneStreamMessage) => {
        lastMessageAt = Date.now();
        if (message.type === "eose") {
          establish();
          void flushReplay();
          eosed = true;
          return;
        }
        if (message.type === "ended") {
          state.outcome = message.outcome;
          finish();
          return;
        }
        establish();
        if (eosed) {
          // Live. Ingest immediately — latency is the point.
          const live = message.event;
          void ingestWireEvents(getSpec(), [live]).then(({ failed }) => {
            if (!failed) writeCursor(relay, live.created_at);
          });
        } else {
          replay.push(message.event);
          if (replay.length >= REPLAY_BATCH_MAX) void flushReplay();
        }
      },
    );
  });
}

function startRelayLoop(
  relay: string,
  filters: Filter[],
  getSpec: () => WireSpec,
): RelayLoop {
  const controller = new AbortController();
  let bumpRound = () => {};

  void (async () => {
    let backoff = knobs.backoffMinMs;
    let wakeSleep: (() => void) | undefined;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", finish);
          wakeSleep = undefined;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        wakeSleep = finish;
        controller.signal.addEventListener("abort", finish);
      });

    await loadCursors();

    while (!controller.signal.aborted) {
      const startedAt = Date.now();
      const now = Math.floor(Date.now() / 1000);
      const cursor = readCursor(relay);
      const floor = now - MAX_CURSOR_AGE_SECONDS;
      const since =
        cursor !== undefined
          ? Math.max(cursor - CURSOR_OVERLAP_SECONDS, floor)
          : now - FRESH_LOOKBACK_SECONDS;

      const round = new AbortController();
      const onOuter = () => round.abort();
      controller.signal.addEventListener("abort", onOuter);
      // Only an ESTABLISHED round may be bumped by a socket reopen — see
      // `watchSocketReopens`. Between rounds the bump only wakes the backoff
      // sleep, which is always safe.
      let established = false;
      bumpRound = () => {
        if (established) round.abort();
        wakeSleep?.();
      };

      const result = await runRound(
        relay,
        filters.map((filter) => ({ ...filter, since })),
        getSpec,
        round.signal,
        () => {
          established = true;
          // This relay is answering, which is the only moment a queued send can
          // count on the socket its publish path needs. Coalesced by the bus,
          // so a spec change that restarts every round rings once.
          emitWireScopes([wireUpScope(relay)]);
        },
      );
      controller.signal.removeEventListener("abort", onOuter);
      if (controller.signal.aborted) break;

      if (result.outcome === "refused") {
        // The relay gates kind 1059 and turned us away — routine on the first
        // round, because a relay connects on the first REQ and the REQ therefore
        // races the NIP-42 challenge. Wait for the stream AUTHs to be ANSWERED
        // before re-issuing: retrying at round-trip speed into a refusal is the
        // ~17k REQ/s flood phase 3 measured against a third party's relay.
        await whenAuthAnswered(relay, streamPubkeysForRelay(relay));
      }
      if (controller.signal.aborted) break;

      // A round that lived a while earned a prompt retry; a relay slamming the
      // door backs off.
      if (Date.now() - startedAt > HEALTHY_ROUND_MS)
        backoff = knobs.backoffMinMs;
      await sleep(backoff + Math.floor(Math.random() * 250));
      backoff = Math.min(backoff * 2, knobs.backoffMaxMs);
    }
  })();

  return {
    sig: subSignature(filters),
    stop: () => controller.abort(),
    bump: () => bumpRound(),
  };
}

// ── The mount ───────────────────────────────────────────────────────────────

const loops = new Map<string, RelayLoop>();
let currentSpec: WireSpec | undefined;
let visibilityBound = false;

/** Per-relay `open$` subscriptions, and the pool watcher that adds them. */
const reopenWatchers = new Map<string, Subscription>();
let poolWatch: Subscription | undefined;

/**
 * Re-REQ a relay the instant its socket reopens under a LIVE round.
 *
 * A reopen means a fresh NIP-42 challenge and an empty subscription table on the
 * relay's side, so a round that was running is dead whether or not it ever says
 * so. Waiting out the 90s quiet watchdog is the difference between "live" and
 * "eventually".
 *
 * The gate is in `bump()`: it only fires once the current round has heard
 * something. This is not a nicety. applesauce connects ON DEMAND and drops the
 * socket 30s after the last subscription unsubscribes (`keepAlive`), so most
 * opens are caused by the wire's own REQ rather than by the relay — and bumping
 * on those aborts the round that opened the socket. Once the backoff has climbed
 * to its 60s ceiling, that becomes an absorbing state: sleep 60s, socket closes
 * at 30s, next round reconnects, its own open kills it before it hears anything,
 * so the round is never healthy enough to reset the backoff. The relay goes
 * permanently deaf with nothing logged.
 *
 * Armada is not a precedent for the unguarded version: its `onRelayReopened`
 * comes off a transport that holds the socket independently of the wire, so
 * there every reopen really is relay-initiated.
 */
function watchSocketReopens(): void {
  const watch = (relay: Relay) => {
    if (reopenWatchers.has(relay.url)) return;
    reopenWatchers.set(
      relay.url,
      relay.open$.subscribe(() => loops.get(relay.url)?.bump()),
    );
  };
  for (const relay of concordPool.relays.values()) watch(relay);
  poolWatch ??= concordPool.add$.subscribe((relay) => watch(relay));
}

/** The spec the ingest path reads — lazily, so a long-lived round always
 *  decrypts with the latest keys rather than the ones it started with. */
const getSpec = (): WireSpec =>
  currentSpec ?? {
    subs: [],
    channelByPk: new Map(),
    communityByChannel: new Map(),
    controlByPk: new Map(),
    sig: "[]",
  };

function onVisible(): void {
  if (document.visibilityState !== "visible") return;
  // A backgrounded tab has its timers throttled and its sockets idled, so the
  // watchdog's 30s/90s stretches to minutes and a dead subscription goes
  // unnoticed long after the user is back. Re-REQ from the cursor immediately —
  // lossless, and it drains whatever the throttled round missed.
  for (const loop of loops.values()) loop.bump();
}

/**
 * Point the wire at a new spec, restarting only the relays whose own filters
 * changed.
 *
 * The per-relay diff is not an optimisation. The inputs settle several times
 * during startup — the community list, then each fold, then the channel view —
 * and tearing down every relay's standing REQ on each settle aborts catch-up
 * replays mid-flight and re-issues (and re-auths) every subscription, most with
 * identical filters.
 */
export function setWireSpec(spec: WireSpec): void {
  currentSpec = spec;

  // Stream auth must be watching BEFORE the first REQ opens a socket: the wire's
  // rounds are what trigger the connection, and a challenge arriving with no
  // listener leaves the round refused for no reason. Idempotent.
  startConcordStreamAuth();

  watchSocketReopens();
  if (!visibilityBound && typeof document !== "undefined") {
    visibilityBound = true;
    document.addEventListener("visibilitychange", onVisible);
  }

  const desired = new Map<string, WireSub>(
    spec.subs.map((sub) => [sub.relay, sub]),
  );
  for (const [relay, loop] of loops) {
    const sub = desired.get(relay);
    if (!sub || subSignature(sub.filters) !== loop.sig) {
      loop.stop();
      loops.delete(relay);
    }
  }
  for (const [relay, sub] of desired) {
    if (!loops.has(relay)) {
      loops.set(relay, startRelayLoop(relay, sub.filters, getSpec));
    }
  }

  // A changed spec means a changed held-key set, which is exactly when a parked
  // wrap becomes readable.
  void drainParkedWraps(spec).catch(() => undefined);

  // And ring for every relay we are now holding a round on, so a queued send
  // gets its chance without waiting for a round to be re-established. A loop
  // that was left running never fires `onEstablished` again.
  emitWireScopes([...loops.keys()].map(wireUpScope));

  const authors = spec.subs.reduce(
    (n, sub) =>
      n + sub.filters.reduce((m, f) => m + (f.authors?.length ?? 0), 0),
    0,
  );
  console.debug(
    `[concord] wire: ${spec.subs.length} relay(s), ${authors} author(s)`,
  );
}

/** Tear the wire down. Idempotent. */
export function stopWire(): void {
  for (const loop of loops.values()) loop.stop();
  loops.clear();
  currentSpec = undefined;
  poolWatch?.unsubscribe();
  poolWatch = undefined;
  for (const watcher of reopenWatchers.values()) watcher.unsubscribe();
  reopenWatchers.clear();
  if (visibilityBound && typeof document !== "undefined") {
    visibilityBound = false;
    document.removeEventListener("visibilitychange", onVisible);
  }
}

/** Which relays the wire is currently holding a round open on. */
export const wireRelays = (): string[] => [...loops.keys()];
