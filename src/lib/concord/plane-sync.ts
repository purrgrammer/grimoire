/**
 * The Control Plane sweep — the one fetch/decrypt/cursor discipline for a
 * community's kind-1059 control traffic.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/planeSync.ts`), narrowed to the
 * Control Plane. Guestbook (forward-cursored) lands in phase 7; the Refounding's
 * `exhaustive` read, `controlSweepQuorum` and the cross-community relay batching
 * are deliberately absent — grimoire never compacts and never rotates.
 *
 * **COMPLETE mode, and why there is no persisted cursor.** A persisted forward
 * cursor on the control plane silently starves the fold: the cursor key outlives
 * a leave/ban/rejoin and the held-epoch set it was minted under, so any edition
 * below the high-water mark that was never ingested — an unban published while
 * the client was offline, a compaction re-wrap under a newly-held epoch — stays
 * invisible forever, and the client then folds a stale banlist and mis-renders
 * membership. So the cadence is TWO-TIER with the delta floor in SESSION memory
 * only: the first sweep of a scope each session re-fetches the WHOLE plane,
 * paging past the relay's per-filter limit, as does every sweep once the floor
 * ages out, after a truncated read, and after the fold reports `incomplete`
 * ({@link markControlPlaneStale}). Sweeps between ride a short-overlap `since`
 * off the last clean full read — wraps are immutable and Concord does not
 * backdate them (CORD-01), so the overlap only has to cover publisher clock
 * skew.
 *
 * **WHAT A SWEEP DOES NOT KNOW: whether it read everything.** Page size is the
 * relay's own policy, and a relay withholding the tail answers exactly like an
 * exhausted one. So nothing here asserts completeness. It reports only facts
 * about ITSELF — `controlSweepTruncated` (we stopped on our own budget) and
 * `controlSweepReach` (which relays answered at all). "Is the state we folded
 * self-consistent" is answered locally by the fold instead, via
 * `FoldedControl.incomplete`.
 */

import type { Filter, NostrEvent } from "nostr-tools";
import type { RelayPool } from "applesauce-relay";

import { guestbookGroups } from "@/lib/concord/guestbook";
import { KIND_WRAP } from "@/lib/concord/kinds";
import {
  planeRequest,
  type PlaneReadOutcome,
} from "@/lib/concord/plane-request";
import { openWrap, type OpenedWireEvent } from "@/lib/concord/stream";
import {
  relayHasChallenged,
  streamAuthsSettled,
} from "@/lib/concord/stream-auth";
import type { GroupKey, StreamKeyView } from "@/lib/concord/derive";
import type { Community } from "@/lib/concord/types";
import {
  readControlSnapshot,
  writeOpened,
} from "@/services/concord-rumor-store";
import db from "@/services/db";

// ── Knobs (armada's constants, verbatim) ─────────────────────────────────────

const paging = {
  /** Per-filter page size. */
  pageLimit: 500,
  /**
   * The most wraps one scope may pull in a single sweep. Plane depth is
   * attacker-controlled — any member holds the key that mints wraps — so
   * SOMETHING has to bound a routine sweep. A fixed event count, never a wall
   * clock: a deadline silently gives a member on fibre a deeper read than the
   * same member on 4G behind Tor, turning "how much of the community do you
   * see" into a function of connection quality. A count is the same everywhere
   * and can be matched by other clients.
   */
  maxEvents: 15_000,
  /**
   * Limit for the single wide ask that drains a same-second wall. Deliberately
   * far past a normal page: the question is not "give me a page of this
   * second", it is "hand over the whole second".
   */
  wallPage: 10_000,
  queryTimeoutMs: 25_000,
};

/** Test seam: shrink the page size so the pager is exercisable with few events. */
export function _configureSweepPagingForTests(
  cfg: Partial<typeof paging>,
): void {
  Object.assign(paging, cfg);
}

const cadence = {
  /** How long a clean full read licenses delta sweeps before the next full one. */
  fullSweepIntervalMs: 6 * 60 * 60_000,
  /** Overlap behind the floor's newest wrap (publisher clock skew only). */
  deltaOverlapSecs: 3600,
};

/** Test seam: force every sweep full (`fullSweepIntervalMs: 0`) or pin the overlap. */
export function _configureSweepCadenceForTests(
  cfg: Partial<typeof cadence>,
): void {
  Object.assign(cadence, cfg);
}

/** Max unbroken main-thread time (ms) spent decrypting before yielding. */
const DECODE_SLICE_MS = 5;

// ── Scopes ───────────────────────────────────────────────────────────────────

/**
 * The scope key for one community's Control Plane on one relay.
 *
 * EPOCH-KEYED: a Refounding changes which plane address this scope reads, so
 * carrying the same key across the rotation would leave the previous epoch's
 * truncation and reach verdicts standing over a plane they say nothing about.
 */
export const controlScopeKey = (community: Community, relayUrl: string) =>
  `control:${community.idHex}@${community.rootEpoch}|${relayUrl}`;

/**
 * Per-scope delta floor: the time of the last CLEAN full read and the newest
 * wrap `created_at` seen. SESSION-ONLY on purpose — persisting it would
 * recreate the forward-cursor starvation described above; losing it merely
 * costs one full re-read on the next launch, which is the launch's job anyway.
 */
const completeFloors = new Map<string, { fullAt: number; newest: number }>();

/**
 * Forget the delta floors for one community's control scopes, so its NEXT sweep
 * re-reads the whole plane. Called when the fold reports `incomplete` — a
 * floored entity the served editions can't account for is exactly the "an
 * edition below the floor never arrived" case a delta sweep cannot heal.
 */
export function markControlPlaneStale(community: Community): void {
  for (const url of community.relays) {
    completeFloors.delete(controlScopeKey(community, url));
  }
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

/**
 * Scope keys whose most recent sweep stopped on OUR OWN budget.
 *
 * Deliberately NOT the inverse: there is no "this scope was read whole" flag,
 * because no client can establish that. Anything built on inferred exhaustion
 * is a guess wearing a proof's clothes.
 */
const scopeTruncated = new Map<string, boolean>();

/** Scope keys the last sweep actually got an answer from. */
const scopeReached = new Set<string>();

/** Wraps the last sweep fetched but could not open, per scope. */
const unreadableScopes = new Map<string, number>();

let verdictRevision = 0;
const verdictListeners = new Set<() => void>();

function bumpVerdicts(): void {
  verdictRevision++;
  for (const listener of verdictListeners) {
    try {
      listener();
    } catch {
      // A listener must never break a sweep.
    }
  }
}

/** `useSyncExternalStore` pair for the sweep verdicts. */
export function subscribeSweepVerdicts(listener: () => void): () => void {
  verdictListeners.add(listener);
  return () => {
    verdictListeners.delete(listener);
  };
}
export function sweepVerdictRevision(): number {
  return verdictRevision;
}

/**
 * Whether the last control sweep of this community stopped short on ANY relay.
 * The only completeness claim the sweep makes, and it is a claim about this
 * client, not about the relays.
 */
export function controlSweepTruncated(community: Community): boolean {
  return community.relays.some(
    (url) => scopeTruncated.get(controlScopeKey(community, url)) === true,
  );
}

/** How many of this community's relays answered the last control sweep. */
export function controlSweepReach(community: Community): {
  reached: number;
  total: number;
} {
  return {
    reached: community.relays.filter((url) =>
      scopeReached.has(controlScopeKey(community, url)),
    ).length,
    total: community.relays.length,
  };
}

/**
 * The worst single relay's tally of unreadable wraps. Max, not sum: the same
 * junk served by several relays is one attack, not several.
 *
 * Undecryptable junk is the CHEAPEST way to inflate a plane — no encryption to
 * do, just a signature with a key every member holds — and it is invisible
 * downstream, since it never becomes a stored rumor. It still spends the fetch
 * budget, so the sweep is the only place that can count it.
 */
export function controlSweepUnreadable(community: Community): number {
  let worst = 0;
  for (const url of community.relays) {
    worst = Math.max(
      worst,
      unreadableScopes.get(controlScopeKey(community, url)) ?? 0,
    );
  }
  return worst;
}

// ── Seen / junk wrap memos ───────────────────────────────────────────────────

/**
 * Wrap ids already processed (decrypted, or judged garbage). Full-plane sweeps
 * re-receive the same wraps every round, so the memo keeps repeat sweeps
 * decrypt-free. Ids are content-addressed, so the same wrap from a second relay
 * is deduped too.
 *
 * PERSISTED: an id is noted only once its rumor is durably stored, and the fold
 * re-reads the store, so a cold launch can skip re-decrypting the whole plane. A
 * session-only memo made every relaunch re-pay the full NIP-44 + Schnorr pass
 * over thousands of wraps.
 */
const seenWraps = new Set<string>();
const SEEN_WRAPS_CAP = 16_384;
const SEEN_WRAPS_KEY = "concordSeenWraps";

/**
 * Wrap ids that were fetched and would NOT open. Persisted beside the memo: the
 * memo stops junk being re-decrypted, which would otherwise make the unreadable
 * tally read zero on every later sweep — blind on exactly the device that needs
 * telling, a returning admin looking at a standing flood.
 */
const junkWraps = new Set<string>();
/**
 * Capped like the seen-memo, and for a sharper reason: the set exists BECAUSE
 * someone may be pumping unlimited junk, so leaving it unbounded turns the
 * counter that detects a flood into a second, local flood.
 */
const JUNK_WRAPS_CAP = 4_096;
const JUNK_WRAPS_KEY = "concordJunkWraps";

const PERSIST_DEBOUNCE_MS = 1_000;
let memoLoaded: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function loadMemos(): Promise<void> {
  memoLoaded ??= Promise.all([
    db.concordKv.get(SEEN_WRAPS_KEY),
    db.concordKv.get(JUNK_WRAPS_KEY),
  ])
    .then(([seen, junk]) => {
      if (Array.isArray(seen?.value)) {
        for (const id of seen.value)
          if (typeof id === "string") seenWraps.add(id);
      }
      if (Array.isArray(junk?.value)) {
        for (const id of junk.value)
          if (typeof id === "string") junkWraps.add(id);
      }
    })
    .catch(() => undefined);
  return memoLoaded;
}

function schedulePersist(): void {
  if (persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void db.concordKv.put({ key: SEEN_WRAPS_KEY, value: [...seenWraps] });
    void db.concordKv.put({ key: JUNK_WRAPS_KEY, value: [...junkWraps] });
  }, PERSIST_DEBOUNCE_MS);
}

/** Evict the oldest half once a memo passes its cap. */
function evict(set: Set<string>, cap: number): void {
  if (set.size <= cap) return;
  let toDrop = set.size - cap / 2;
  for (const id of set) {
    if (toDrop-- <= 0) break;
    set.delete(id);
  }
}

/** Mark wrap ids as fetched-but-unopenable. */
export function notePlaneWrapsJunk(ids: string[]): void {
  if (ids.length === 0) return;
  for (const id of ids) junkWraps.add(id);
  evict(junkWraps, JUNK_WRAPS_CAP);
  schedulePersist();
}

/**
 * Mark wrap ids as processed. Call ONLY once their rumors are durably stored
 * (or they failed to open under a held key — permanent garbage, since every
 * wrap here matched a held group's address).
 */
export function notePlaneWrapsSeen(ids: string[]): void {
  const before = seenWraps.size;
  for (const id of ids) seenWraps.add(id);
  evict(seenWraps, SEEN_WRAPS_CAP);
  if (seenWraps.size !== before) schedulePersist();
}

/**
 * Narrow a batch to the wraps neither transport has already processed.
 *
 * Shared with the wire on purpose: a wrap decrypted by the sweep must never be
 * re-decrypted by a standing subscription, or a quiet rotation's replay re-pays
 * the full NIP-44 open plus Schnorr verify for every wrap in the overlap window.
 */
export async function unseenPlaneWraps(
  wraps: NostrEvent[],
): Promise<NostrEvent[]> {
  await loadMemos();
  return wraps.filter((w) => !seenWraps.has(w.id) && !junkWraps.has(w.id));
}

/**
 * Drop the sweep's in-memory verdicts and wrap memos.
 *
 * Called on logout. These hold wrap ids and per-scope read state belonging to
 * the account that just left; the persisted copies go with `concordKv`.
 */
export function resetPlaneSweepMemory(): void {
  seenWraps.clear();
  junkWraps.clear();
  scopeTruncated.clear();
  scopeReached.clear();
  unreadableScopes.clear();
  completeFloors.clear();
  inflight.clear();
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  memoLoaded = Promise.resolve();
}

/** Test seam: as {@link resetPlaneSweepMemory}, plus the persisted memos. */
export function _resetPlaneSweepForTests(): void {
  resetPlaneSweepMemory();
  void db.concordKv.delete(SEEN_WRAPS_KEY);
  void db.concordKv.delete(JUNK_WRAPS_KEY);
}

// ── Decrypt ──────────────────────────────────────────────────────────────────

/**
 * Decrypt plane wraps under the held groups, yielding the event loop whenever a
 * slice runs past {@link DECODE_SLICE_MS}. Each wrap costs a NIP-44 open plus a
 * Schnorr verify (plus a second open for an encrypted seal) — all synchronous
 * noble crypto — so decoding a whole plane in one unbroken loop freezes the UI
 * for the duration on a phone.
 */
export async function openPlaneWraps(
  wraps: NostrEvent[],
  groups: StreamKeyView[],
): Promise<OpenedWireEvent[]> {
  const byPk = new Map(groups.map((g) => [g.pk, g]));
  const out: OpenedWireEvent[] = [];
  let sliceStart = Date.now();
  for (let i = 0; i < wraps.length; i++) {
    const group = byPk.get(wraps[i].pubkey);
    if (group) {
      try {
        out.push(openWrap(wraps[i], group));
      } catch {
        // not ours / malformed
      }
    }
    if (i + 1 < wraps.length && Date.now() - sliceStart >= DECODE_SLICE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }
  return out;
}

// ── The pager ────────────────────────────────────────────────────────────────

export interface SweepOutcome {
  total: number;
  truncated: boolean;
  /** Whether the relay answered at all (as opposed to refusing or dying). */
  answered: boolean;
  /** The relay's NIP-42 gate turned us away. Distinct from an empty plane. */
  refused: boolean;
}

/** Hard cap on the auth gate, so a key that never acks can't stall a sweep. */
const AUTH_WAIT_MS = 8_000;

/**
 * After a REFUSED read, wait until this relay's stream AUTHs have actually been
 * answered — then the same REQ is worth re-issuing.
 *
 * On grimoire's pool a relay connects on the FIRST REQ, so a plane REQ racing
 * the NIP-42 challenge is the common path rather than an edge case: the read is
 * refused, the challenge arrives on the now-open socket, the auth wiring answers
 * it, and the retry succeeds on the same connection.
 *
 * The refusal is what proves the relay gates, so this deliberately waits for the
 * challenge to be RECORDED (`relayHasChallenged`) as well as acked — unlike
 * `streamAuthsSettled`, which reports settled for a relay that never challenged
 * and would let the retry fire straight back into the same refusal.
 */
export async function whenAuthAnswered(
  url: string,
  pubkeys: string[],
): Promise<void> {
  const deadline = Date.now() + authWaitMs;
  for (;;) {
    if (relayHasChallenged(url) && streamAuthsSettled(url, pubkeys)) return;
    if (Date.now() >= deadline) return;
    await new Promise((r) =>
      setTimeout(r, Math.max(1, Math.min(50, deadline - Date.now()))),
    );
  }
}

/** Test seam: shorten the auth gate so sweeps run immediately. */
let authWaitMs = AUTH_WAIT_MS;
export function _configureAuthWaitForTests(ms: number): void {
  authWaitMs = ms;
}

/**
 * Page one scope oldest-ward past the relay's per-filter limit, until a short
 * page says the relay has no more to give or our own budget runs out.
 *
 * Pages STREAM to `onPage` and are then dropped; only wrap ids are retained,
 * for the cross-page dedupe. Plane depth is attacker-controlled, so a deep plane
 * must cost bandwidth and time, never heap — accumulating it here is how a flood
 * becomes an OOM instead of a slow sync.
 *
 * `truncated` means ONE thing: WE stopped — on the event budget, or over a
 * second wider than a single ask can drain. Never an inference about the relay.
 *
 * Page fullness is judged against the CALLER'S `filter.limit`, not the module
 * knob. A caller asking for a smaller page than `paging.pageLimit` would
 * otherwise have every full page read as short, so the walk would stop after
 * page one — paging-shaped code that does not page.
 */
export async function pageScope(
  relayUrl: string,
  filter: Filter,
  onPage: (page: NostrEvent[]) => Promise<void>,
  pool?: RelayPool,
): Promise<SweepOutcome> {
  // A relay's answer is NOT the filter we sent. Every page must be narrowed the
  // same way, or an off-filter event can (a) drag the cursor below the rest of
  // the plane and (b) be memoed as processed — which permanently stops that
  // wrap from ever being decrypted, by this pager or anything else sharing the
  // memo. The `created_at` bound is enforced for the same reason.
  const pageLimit = filter.limit ?? paging.pageLimit;
  const wanted = new Set(filter.authors ?? []);
  const mine = (events: NostrEvent[], until: number) =>
    events.filter(
      (e) =>
        e.kind === KIND_WRAP && wanted.has(e.pubkey) && e.created_at <= until,
    );

  const first = await planeRequest(relayUrl, filter, {
    timeout: paging.queryTimeoutMs,
    pool,
  });
  if (first.outcome !== "eose") {
    // Refused, closed, timed out or errored. NOT an empty plane — recording it
    // as one would let a stale floor stand over a plane we never read.
    return {
      total: 0,
      truncated: false,
      answered: false,
      refused: first.outcome === "refused",
    };
  }

  const firstPage = mine(first.events, Number.MAX_SAFE_INTEGER);
  const seen = new Set(firstPage.map((e) => e.id));
  await onPage(firstPage);
  if (firstPage.length === 0) {
    return { total: 0, truncated: false, answered: true, refused: false };
  }

  // `until` is INCLUSIVE, so consecutive pages overlap by one timestamp on
  // purpose: the overlap steps over a same-second boundary instead of skipping
  // it, and the id dedupe makes it free.
  let cursor = Math.min(...firstPage.map((e) => e.created_at));
  let full = firstPage.length >= pageLimit;
  /** We stepped over part of a second we could not page through. */
  let walled = false;

  while (full) {
    if (seen.size >= paging.maxEvents) {
      // Members get highest-reasonable-effort, not a guarantee: fold what
      // arrived and converge on later sweeps.
      console.warn(
        `[concord] ${relayUrl}: hit the ${paging.maxEvents}-event sweep budget; older plane left for a later round`,
      );
      return {
        total: seen.size,
        truncated: true,
        answered: true,
        refused: false,
      };
    }
    const next = await planeRequest(
      relayUrl,
      { ...filter, until: cursor },
      { timeout: paging.queryTimeoutMs, pool },
    );
    if (next.outcome !== "eose") {
      // The relay stopped answering mid-walk. What we have is what we have, and
      // the plane below the cursor went unread — which is a truncation.
      return {
        total: seen.size,
        truncated: true,
        answered: true,
        refused: false,
      };
    }
    const page = mine(next.events, cursor);
    full = page.length >= pageLimit;
    const fresh = page.filter((e) => !seen.has(e.id));
    if (fresh.length > 0) {
      for (const e of fresh) seen.add(e.id);
      await onPage(fresh);
    }
    const lowest =
      page.length > 0 ? Math.min(...page.map((e) => e.created_at)) : cursor;
    if (lowest < cursor) {
      cursor = lowest;
    } else if (full) {
      // A full page that didn't move the cursor: every event in it sits AT
      // `cursor`, and `until` is inclusive, so asking again returns the same
      // block forever. That is a same-second wall — more wraps at one timestamp
      // than a page holds, and the cheapest way to stall a pager, since a
      // wrap's created_at is the publisher's to choose. Ask for the whole
      // second in one go.
      const wide = await planeRequest(
        relayUrl,
        { ...filter, since: cursor, until: cursor, limit: paging.wallPage },
        { timeout: paging.queryTimeoutMs, pool },
      );
      const drained = wide.outcome === "eose" ? mine(wide.events, cursor) : [];
      const stillNew = drained.filter((e) => !seen.has(e.id));
      for (const e of stillNew) seen.add(e.id);
      if (stillNew.length > 0) await onPage(stillNew);

      // Did that ask actually EMPTY the second? The answer is credible in only
      // one narrow band: strictly more than a normal page (so the relay is not
      // simply capping us at its usual limit and calling it a second) and
      // strictly fewer than we asked for (so it stopped because it ran out, not
      // because it hit our ceiling).
      //
      // Outside that band we cannot tell "the second holds exactly this" from
      // "the relay will not serve more of it" — a relay capped at 500 answers a
      // 10,000 request with 500 either way. Checking only against the limit we
      // asked for reads that capped relay as a drained one and loses the
      // remainder with NO signal, which is worse than the stall it replaced.
      //
      // Either way the cursor steps below the second: a repeat of the widest
      // ask we can make cannot return more than it just did.
      const emptied =
        drained.length > pageLimit && drained.length < paging.wallPage;
      if (!emptied) {
        console.warn(
          `[concord] ${relayUrl}: cannot prove second ${cursor} was read whole (${drained.length} served)`,
        );
        walled = true;
      }
      cursor -= 1;
    } else {
      break;
    }
  }
  return {
    total: seen.size,
    truncated: walled,
    answered: true,
    refused: false,
  };
}

// ── The sweep ────────────────────────────────────────────────────────────────

/** In-flight sweeps by scope key. */
const inflight = new Map<string, Promise<OpenedWireEvent[]>>();

export interface ControlSweepOptions {
  /** Called with this scope's decrypted events once they are committed. */
  onFresh?: (fresh: OpenedWireEvent[]) => void;
  /**
   * Relay pool to read through. Defaults to grimoire's singleton; a test hands
   * in its own so a mock relay does not leak into the shared pool.
   */
  pool?: RelayPool;
}

/**
 * Sweep one community's Control Plane on one relay.
 *
 * Single-flight per scope key: a session-start sweep and a fold-`incomplete`
 * retrigger routinely overlap, and running both would have them race to publish
 * the scope's verdict.
 */
export function sweepControlRelay(
  community: Community,
  relayUrl: string,
  group: StreamKeyView,
  opts: ControlSweepOptions = {},
): Promise<OpenedWireEvent[]> {
  const scope = controlScopeKey(community, relayUrl);
  const existing = inflight.get(scope);
  if (existing) {
    return existing.then((fresh) => {
      if (fresh.length > 0) opts.onFresh?.(fresh);
      return fresh;
    });
  }
  const run = runControlScope(community, relayUrl, group, scope, opts);
  inflight.set(scope, run);
  void run.finally(() => {
    if (inflight.get(scope) === run) inflight.delete(scope);
  });
  return run;
}

async function runControlScope(
  community: Community,
  relayUrl: string,
  group: StreamKeyView,
  scope: string,
  opts: ControlSweepOptions,
): Promise<OpenedWireEvent[]> {
  await loadMemos();

  // A Refounded community whose snapshot id-set has gone missing must re-ingest
  // the plane WITHOUT the seen-memo narrowing. The set is recorded only when a
  // wrap is fresh, so once every wrap is memoed a lost set can never be
  // re-recorded by an ordinary sweep — and the fold then anchors a Refounded
  // community on an empty snapshot, outranking nothing. Known junk stays
  // skipped: it never opened, so it never fed the set.
  const refounded = community.rootEpoch > 0n;
  const rebuildSnapshot =
    refounded && !(await readControlSnapshot(community.idHex, group.pk));

  // A fresh session floor licenses a short-overlap delta read; anything else —
  // no floor, an aged floor, a snapshot rebuild — re-fetches the whole plane.
  const floor = completeFloors.get(scope);
  const deltaSince =
    rebuildSnapshot || !floor || floor.newest <= 0
      ? undefined
      : Date.now() - floor.fullAt >= cadence.fullSweepIntervalMs
        ? undefined
        : Math.max(0, floor.newest - cadence.deltaOverlapSecs);

  const filter: Filter = {
    kinds: [KIND_WRAP],
    authors: [group.pk],
    limit: paging.pageLimit,
    ...(deltaSince !== undefined ? { since: deltaSince } : {}),
  };

  // Invalidate BEFORE the read, never after: a sweep that dies must leave no
  // verdict standing, or the next caller reads a stale "reached, not truncated"
  // and acts on a picture this sweep never established.
  scopeTruncated.delete(scope);
  scopeReached.delete(scope);
  unreadableScopes.set(scope, 0);
  bumpVerdicts();

  const fresh: OpenedWireEvent[] = [];
  let newest = 0;

  const ingest = async (page: NostrEvent[]) => {
    for (const w of page) newest = Math.max(newest, w.created_at);
    // Narrow by the memo BEFORE advancing it, or nothing ever decrypts.
    const candidates = rebuildSnapshot
      ? page.filter((w) => !junkWraps.has(w.id))
      : page.filter((w) => !seenWraps.has(w.id));
    const opened = await openPlaneWraps(candidates, [group]);

    // Anything attempted that didn't open is junk, remembered so later sweeps
    // can still count it without re-attempting the decrypt.
    const openedIds = new Set(opened.map((e) => e.wrapId));
    notePlaneWrapsJunk(
      candidates.filter((w) => !openedIds.has(w.id)).map((w) => w.id),
    );
    // Tally over the WHOLE page, from what is known junk — not just this page's
    // new arrivals, or a standing flood would count once and read zero forever.
    unreadableScopes.set(
      scope,
      (unreadableScopes.get(scope) ?? 0) +
        page.filter((w) => junkWraps.has(w.id)).length,
    );

    let stored = true;
    if (opened.length > 0) {
      stored = (
        await writeOpened(community.idHex, opened, "control", { refounded })
      ).ok;
      if (stored) fresh.push(...opened);
    }
    // The memo advances only once the rumors are durably stored. It is what
    // stops a later sweep re-decrypting these wraps, so advancing it over a
    // failed write would leave rumors that never reached the store and are
    // never opened again.
    if (stored) notePlaneWrapsSeen(page.map((w) => w.id));
  };

  let outcome = await pageScope(relayUrl, filter, ingest, opts.pool);

  // Re-ask ONCE behind the auth gate. Two distinct cases, both routine on
  // grimoire's pool because a relay connects on the first REQ and so the
  // opening plane REQ races the NIP-42 challenge:
  //
  // - REFUSED: the relay gates and turned us away. The challenge lands on the
  //   now-open socket, the auth wiring answers it, and the same REQ succeeds.
  //   `streamAuthsSettled` is no use as the trigger here — before the challenge
  //   is recorded it reports settled, and the retry would fire straight back
  //   into the refusal.
  // - EMPTY while the AUTHs are known-unacked: a kind-1059 REQ that raced
  //   NIP-42 reads back as a clean empty page, and recording that silence as an
  //   answer is how a fresh login "completes" with zero editions.
  const needsRetry =
    outcome.refused ||
    (outcome.total === 0 && !streamAuthsSettled(relayUrl, [group.pk]));
  if (needsRetry) {
    await whenAuthAnswered(relayUrl, [group.pk]);
    outcome = await pageScope(relayUrl, filter, ingest, opts.pool);
  }

  if (outcome.truncated) scopeTruncated.set(scope, true);
  // An empty answer from a relay whose stream AUTHs are STILL unacked after the
  // retry is a refused read, not an exhausted plane — recording it as reached
  // would report coverage this sweep never established.
  const settled = streamAuthsSettled(relayUrl, [group.pk]);
  if (outcome.answered && (settled || outcome.total > 0)) {
    scopeReached.add(scope);
    // Re-READ the floor here rather than reusing the copy taken at the top of
    // the sweep. `markControlPlaneStale` deletes it, and a sweep in flight when
    // that happens must not write its stale copy back: doing so silently undoes
    // the fold's only escape hatch, and the below-floor edition the fold could
    // not account for stays invisible until the 6-hour age-out.
    const prior = completeFloors.get(scope);
    const high = Math.max(newest, prior?.newest ?? 0);
    // A CLEAN full read (re)establishes the baseline; a truncated one
    // establishes nothing (older plane went unread — the next sweep must re-ask
    // whole); a delta read only raises the floor's high-water mark.
    if (deltaSince === undefined) {
      if (outcome.truncated) completeFloors.delete(scope);
      else completeFloors.set(scope, { fullAt: Date.now(), newest: high });
    } else if (prior) {
      completeFloors.set(scope, { fullAt: prior.fullAt, newest: high });
    }
  }
  bumpVerdicts();

  if (fresh.length > 0) opts.onFresh?.(fresh);
  return fresh;
}

/** Merge opened-event sets by rumor id (a partial round must not drop editions). */
export function mergeOpened(...sets: OpenedWireEvent[][]): OpenedWireEvent[] {
  const byId = new Map<string, OpenedWireEvent>();
  for (const set of sets) for (const e of set) byId.set(e.rumorId, e);
  return [...byId.values()];
}

/**
 * Sweep one community's Control Plane across every relay it lists; union deduped
 * by rumor id.
 *
 * CURRENT EPOCH ONLY. Concord's control plane is compaction-bounded: a
 * Refounding re-wraps every entity's head into the new epoch, so the current
 * plane is a complete snapshot and prior ones are history, not authority.
 * Sweeping them too would mean a plane any member can inflate follows the
 * community across every future rotation, which is exactly what rotating was
 * supposed to escape. Old roots stay held and stream-auth registered for chat
 * history; only this fetch narrows.
 */
export async function sweepControl(
  community: Community,
  group: StreamKeyView,
  opts: ControlSweepOptions = {},
): Promise<OpenedWireEvent[]> {
  const results = await Promise.all(
    community.relays.map((url) =>
      sweepControlRelay(community, url, group, opts),
    ),
  );
  return mergeOpened(...results);
}

// ── The Guestbook sweep (FORWARD-cursored) ──────────────────────────────────
//
// A different cadence from the control sweep above, and the difference is the
// point — do not "consistency-fix" them into each other.
//
// The Guestbook is append-mostly and unbounded, and it is OFF-CONSENSUS: nothing
// in Control or Chat depends on it, and §5's observed-authors rule heals a miss
// by the member's next message. So it rides a PERSISTED forward cursor and never
// re-reads its own history. The Control Plane cannot: its whole job is to
// re-see editions BELOW the high-water mark (an unban published while we were
// offline), which a forward cursor makes permanently invisible.
//
// Armada's shape, kept: ONE request per relay per sweep, no pager. A cursorless
// first sweep therefore reads the newest `pageLimit` entries and no deeper, and
// a burst larger than a page between sweeps loses its middle. Both are armada's
// behaviour and both self-heal by observation, which is why the Guestbook is
// allowed to be the cheap plane.

const GUESTBOOK_CURSOR_PREFIX = "guestbook-cursor:";

/**
 * The scope key for one community's Guestbook on one relay.
 *
 * EPOCH-KEYED, like the control scope but for a sharper reason: a rejoin or a
 * rekey adoption changes WHAT THE MEMBER CAN READ, so the first sweep at a new
 * epoch must be a full backfill. A cursor minted under the old read scope would
 * gate it and the new epoch's history would never be fetched.
 */
export const guestbookScopeKey = (community: Community, relayUrl: string) =>
  `guestbook:${community.idHex}@${community.rootEpoch}|${relayUrl}`;

const guestbookCursors = new Map<string, number>();
let guestbookCursorsLoaded: Promise<void> | undefined;

function loadGuestbookCursors(): Promise<void> {
  guestbookCursorsLoaded ??= db.concordKv
    .where("key")
    .startsWith(GUESTBOOK_CURSOR_PREFIX)
    .toArray()
    .then((rows) => {
      for (const row of rows) {
        if (typeof row.value === "number" && Number.isFinite(row.value)) {
          guestbookCursors.set(
            row.key.slice(GUESTBOOK_CURSOR_PREFIX.length),
            row.value,
          );
        }
      }
    })
    .catch(() => undefined);
  return guestbookCursorsLoaded;
}

/**
 * Advance a scope's cursor, CLAMPED to the local clock and monotone.
 *
 * The clamp is the wire's lesson, and it bites harder here because there is no
 * completeness backstop behind this plane: one entry stamped in the future — a
 * skewed clock, or a hostile timestamp any member can mint — would drag the
 * cursor past `now`, and every later REQ opening with `since > now` goes deaf on
 * that relay forever, because the cursor is durable.
 */
function advanceGuestbookCursor(scope: string, createdAt: number): void {
  const next = Math.min(createdAt, Math.floor(Date.now() / 1000));
  const prev = guestbookCursors.get(scope) ?? 0;
  if (next <= prev) return;
  guestbookCursors.set(scope, next);
  void db.concordKv
    .put({ key: `${GUESTBOOK_CURSOR_PREFIX}${scope}`, value: next })
    .catch(() => undefined);
}

/** Test seam: forget every guestbook cursor, in memory and on disk. */
export async function _resetGuestbookCursorsForTests(): Promise<void> {
  _forgetGuestbookCursorMemoryForTests();
  await db.concordKv.where("key").startsWith(GUESTBOOK_CURSOR_PREFIX).delete();
}

/**
 * Test seam: forget the in-memory cursor cache but KEEP the rows.
 *
 * The only way to exercise the persisted half. A reset that wipes both makes a
 * "the cursor survives a cold launch" test pass against the surviving `Map`,
 * with the Dexie round-trip never executed.
 */
export function _forgetGuestbookCursorMemoryForTests(): void {
  guestbookCursors.clear();
  guestbookCursorsLoaded = undefined;
}

/**
 * Single-flight per scope, like the control sweep: the viewer's open and its
 * refresh interval routinely overlap, and two in-flight reads of the same scope
 * would race to advance one cursor.
 */
function sweepGuestbookRelay(
  community: Community,
  relayUrl: string,
  groups: GroupKey[],
  opts: ControlSweepOptions,
): Promise<OpenedWireEvent[]> {
  const scope = guestbookScopeKey(community, relayUrl);
  const existing = inflight.get(scope);
  if (existing) {
    return existing.then((fresh) => {
      if (fresh.length > 0) opts.onFresh?.(fresh);
      return fresh;
    });
  }
  const run = runGuestbookScope(community, relayUrl, groups, opts);
  inflight.set(scope, run);
  void run.finally(() => {
    if (inflight.get(scope) === run) inflight.delete(scope);
  });
  return run;
}

/** One community's Guestbook on one relay: one REQ, forward of the cursor. */
async function runGuestbookScope(
  community: Community,
  relayUrl: string,
  groups: GroupKey[],
  opts: ControlSweepOptions,
): Promise<OpenedWireEvent[]> {
  await loadGuestbookCursors();
  const scope = guestbookScopeKey(community, relayUrl);
  const pubkeys = groups.map((g) => g.pk);
  const since = guestbookCursors.get(scope);

  const filter: Filter = {
    kinds: [KIND_WRAP],
    authors: pubkeys,
    limit: paging.pageLimit,
    ...(since ? { since } : {}),
  };

  // PAGED, unlike armada, which takes page one and stops.
  //
  // A cursorless first sweep is the whole history of the plane, and a burst
  // larger than one page between sweeps loses its middle — the cursor jumps to
  // the newest entry it saw and `since` never serves the gap again. Armada
  // accepts that because §5's observed-authors rule heals it for anyone who
  // speaks; it does not heal for the silent, who are exactly the members only
  // the Guestbook knows about. `pageScope` already walks `until` backwards and
  // stops on a short page, and the `since` floor makes it terminate at the
  // cursor rather than at the beginning of time — so this is more complete than
  // armada and never less, which is the only direction a divergence may go.
  const fresh: OpenedWireEvent[] = [];
  let newest = 0;
  let failed = false;

  const ingest = async (batch: NostrEvent[]) => {
    for (const wrap of batch) newest = Math.max(newest, wrap.created_at);
    const opened = await openPlaneWraps(batch, groups);
    // A page that decrypted to NOTHING still advances the cursor, as in armada.
    // The guestbook address is member-derivable, so any member can mint wraps
    // there that never open; pinning the cursor on them would re-decrypt the
    // same junk on every sweep, and this path has no seen-memo to stop it. They
    // are permanently unopenable under keys we already hold, so there is
    // nothing behind them to come back for.
    if (opened.length === 0) return;
    const written = await writeOpened(community.idHex, opened, "guestbook", {
      refounded: community.rootEpoch > 0n,
    });
    if (written.ok) fresh.push(...opened);
    else failed = true;
  };

  let outcome = await pageScope(relayUrl, filter, ingest, opts.pool);
  // The same two routine races the control sweep handles, and for the same
  // reason: on this pool a relay connects on the FIRST REQ, so the opening read
  // races the NIP-42 challenge. A refusal, or an empty answer while the AUTHs
  // are known-unacked, is not an exhausted plane.
  if (
    outcome.refused ||
    (outcome.total === 0 && !streamAuthsSettled(relayUrl, pubkeys))
  ) {
    await whenAuthAnswered(relayUrl, pubkeys);
    outcome = await pageScope(relayUrl, filter, ingest, opts.pool);
  }
  if (!outcome.answered || newest === 0) return fresh;

  // DIVERGENCE from armada, narrowing and deliberate: armada advances this
  // cursor without checking the write. A forward cursor is the one place that
  // cannot be forgiven — a `since` filter will never serve these wraps again,
  // and the seen-memo offers no second chance either, so advancing over a
  // failed Dexie write loses them for good. Same for a TRUNCATED walk: the
  // plane below where we stopped went unread, and the cursor must not claim it.
  if (failed || outcome.truncated) return fresh;

  advanceGuestbookCursor(scope, newest);
  if (fresh.length > 0) opts.onFresh?.(fresh);
  return fresh;
}

/**
 * Sweep one community's Guestbook across every relay it lists; union deduped by
 * rumor id.
 *
 * ALL HELD EPOCHS, unlike the control sweep. The Guestbook is not
 * compaction-bounded: a Refounding seeds the new epoch's stream with a snapshot
 * of present members, but the prior epochs' Joins and Kicks remain the only
 * record for anyone the refounder's snapshot predates — and a snapshot is
 * honored only from the epoch's own refounder, which we may not have recorded.
 */
export async function sweepGuestbook(
  community: Community,
  opts: ControlSweepOptions = {},
): Promise<OpenedWireEvent[]> {
  const groups = guestbookGroups(community);
  if (groups.length === 0) return [];
  const results = await Promise.all(
    community.relays.map((url) =>
      sweepGuestbookRelay(community, url, groups, opts).catch(() => []),
    ),
  );
  return mergeOpened(...results);
}

export type { PlaneReadOutcome };
