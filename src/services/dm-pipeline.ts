/**
 * One inbox pipeline per account, however many windows are watching it.
 *
 * Every mounted `useDirectMessages` used to run the whole sequence itself:
 * resolve the relays, open a standing REQ, sync two pages, walk the history,
 * import the legacy plane. Three panes are open in an ordinary session — a
 * chat browser, a second window, a NIP-17 conversation — so all of it ran three
 * times over, three standing REQs deep, and the two-minute top-up ran three
 * times every two minutes. The decryptions deduplicate through the seen-wrap
 * memo, so the waste was invisible; the REQs and the relay traffic were not.
 *
 * So the pipeline belongs to the ACCOUNT and the components hold references to
 * it. The last one to leave takes it down, which is also what makes a handoff
 * work: a window closing while another is still open does not interrupt a walk
 * halfway through, the way a leader-election between components would.
 *
 * EVERY relay read of the gift-wrap stream comes through here, including the
 * ones a conversation asks for itself — the NIP-17 adapter opening a room and
 * paging it backwards. The inbox is one undifferentiated stream, so two callers
 * asking at once are asking the same question, and the answer reaches all of
 * them the same way regardless of which one paid for it.
 *
 * Nothing here paints. Stored messages reach the UI through `dm-bus`, exactly
 * as they did when a wrap arrived on the live subscription — the only thing
 * this reports is the walk's own progress, which nothing else can observe.
 */

import { BehaviorSubject, type Observable } from "rxjs";
import {
  backfillDmHistory,
  isHistoryExhausted,
  syncDmInbox,
  watchDmInbox,
  type BackfillProgress,
  type DmSigner,
} from "./dm-inbox";
import {
  hasImportedLegacyDms,
  importLegacyDms,
  type LegacySigner,
} from "./dm-legacy-inbox";
import { followedPubkeys, ownDmReadRelays } from "@/lib/dm/relays";

/** Both planes: NIP-44 for the wraps, NIP-04 for the history that predates them. */
export type InboxSigner = DmSigner & LegacySigner;

/**
 * How long a pipeline outlives its last reference.
 *
 * The hook re-runs its effect whenever the list refreshes — on a timer, on
 * focus, on a message landing — and each re-run releases and rejoins. Without
 * a grace period that is a full teardown and a fresh walk every couple of
 * minutes, which is worse than the duplication this file exists to remove.
 */
export const TEARDOWN_GRACE_MS = 10_000;

/**
 * How long to wait before reopening a standing subscription that ended, and
 * how long one has to survive before the next failure counts as a first one.
 *
 * A relay that refuses will refuse again, so this backs off; a socket that a
 * sleeping laptop dropped comes back on the first try, so it starts short.
 */
const REOPEN_DELAYS_MS = [5_000, 15_000, 45_000, 120_000];
const WATCH_HEALTHY_MS = 60_000;

/** How hard to try for a relay set before leaving the start to be retried. */
const RELAY_RESOLVE_ATTEMPTS = 3;
const RELAY_RETRY_MS = 10_000;

interface Run {
  refs: number;
  signer: InboxSigner;
  /**
   * Whether the sequence has been kicked off. Not `refs > 0`: a run inside its
   * grace period has no references and must not be started twice, and a start
   * that could not find a relay clears this so the next join tries again.
   */
  started: boolean;
  teardown?: ReturnType<typeof setTimeout>;
  /**
   * Bumped by every restart. Each step of the walk checks it before writing
   * anything — an aborted walk can still be inside an await when the next one
   * starts, and the two must not interleave their progress.
   */
  generation: number;
  abort: AbortController;
  stopWatching?: () => void;
  reopen?: ReturnType<typeof setTimeout>;
  reopenAttempt: number;
  watchOpenedAt: number;
  relays?: string[];
  /**
   * Settles with the relay set once the start has one, so a read arriving
   * while the start is still resolving waits for it rather than resolving a
   * second set of its own — two callers disagreeing about the relays is how a
   * wrap lands somewhere only one of them was reading.
   */
  relaysReady: Promise<string[] | undefined>;
  settleRelays: (relays: string[] | undefined) => void;
  /** The top-up in flight, shared by everyone who asked while it was running. */
  topUp?: Promise<void>;
  /** Page-back reads in flight, by the boundary each is fetching. */
  pages: Map<number, Promise<void>>;
}

const runs = new Map<string, Run>();

/**
 * Progress lives outside the runs, and outlasts them.
 *
 * A subscriber holds the Observable it was handed; if the subject died with
 * the run, a pane that outlived a teardown-and-restart would sit watching a
 * subject nothing writes to any more.
 */
const progress = new Map<
  string,
  BehaviorSubject<BackfillProgress | undefined>
>();

function progressOf(
  viewer: string,
): BehaviorSubject<BackfillProgress | undefined> {
  let subject = progress.get(viewer);
  if (!subject) {
    subject = new BehaviorSubject<BackfillProgress | undefined>(undefined);
    progress.set(viewer, subject);
  }
  return subject;
}

/** The walk's progress for this account, or undefined when none is running. */
export function dmBackfillProgress(
  viewer: string,
): Observable<BackfillProgress | undefined> {
  return progressOf(viewer);
}

function newRun(signer: InboxSigner): Run {
  let settleRelays: (relays: string[] | undefined) => void = () => {};
  const relaysReady = new Promise<string[] | undefined>((resolve) => {
    settleRelays = resolve;
  });
  return {
    refs: 0,
    signer,
    started: false,
    generation: 0,
    abort: new AbortController(),
    reopenAttempt: 0,
    watchOpenedAt: 0,
    relaysReady,
    settleRelays,
    pages: new Map(),
  };
}

/**
 * Watch this account's inbox for as long as the returned release is uncalled.
 *
 * The first caller starts the pipeline; the rest join the one already running.
 * Releasing twice is a no-op — a React cleanup can run for a closure whose
 * effect already released, and a double decrement would tear down a pipeline
 * other panes are still holding.
 */
export function joinDmInbox(viewer: string, signer: InboxSigner): () => void {
  let run = runs.get(viewer);
  if (!run) {
    run = newRun(signer);
    runs.set(viewer, run);
  } else {
    // A signer can be replaced while the pipeline runs — a bunker reconnected,
    // an extension unlocked. Each step reads it fresh rather than holding the
    // one the walk started with.
    run.signer = signer;
  }
  const joined = run;

  joined.refs += 1;
  if (joined.teardown !== undefined) {
    clearTimeout(joined.teardown);
    joined.teardown = undefined;
  }
  if (!joined.started) {
    joined.started = true;
    void start(viewer, joined, joined.generation);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    joined.refs -= 1;
    if (joined.refs > 0 || joined.teardown !== undefined) return;
    joined.teardown = setTimeout(() => {
      if (joined.refs > 0) return;
      stop(viewer, joined);
    }, TEARDOWN_GRACE_MS);
  };
}

/**
 * Take this account's pipeline down NOW, however many panes still hold it.
 *
 * The grace period below is right for a pane remounting and wrong for an
 * account ceasing to exist: logout wipes the decrypted mail out of Dexie, and
 * a watch left running for another ten seconds happily decrypts the next
 * arriving wrap and writes the plaintext straight back into the tables that
 * were just erased. Signing out is not a reference going away — it is the end
 * of the thing the references were for.
 */
export function stopDmInbox(viewer: string): void {
  const run = runs.get(viewer);
  if (!run) return;
  if (run.teardown !== undefined) clearTimeout(run.teardown);
  run.teardown = undefined;
  // A pane still holding this run will release into a dead object, which is
  // harmless: `stop` has already dropped it from the map, so its teardown
  // cannot delete a pipeline a later sign-in started.
  run.refs = 0;
  stop(viewer, run);
}

function stop(viewer: string, run: Run): void {
  if (run.reopen !== undefined) clearTimeout(run.reopen);
  run.reopen = undefined;
  run.abort.abort();
  run.stopWatching?.();
  run.stopWatching = undefined;
  // Anyone still waiting on the relay set is told there will not be one, so a
  // read parked on a torn-down pipeline resolves its own rather than hanging.
  run.settleRelays(undefined);
  progressOf(viewer).next(undefined);
  if (runs.get(viewer) === run) runs.delete(viewer);
}

/**
 * The relay set this account's inbox is read from, resolved once.
 *
 * Shared by the watch, the catch-up, the walk and every read a conversation
 * asks for. Falls back to resolving directly when no pipeline is running,
 * which is what keeps the adapter working with no pane holding the inbox open.
 */
async function inboxRelays(viewer: string, run?: Run): Promise<string[]> {
  if (run) {
    if (run.relays) return run.relays;
    const ready = await run.relaysReady;
    if (ready) return ready;
  }
  return ownDmReadRelays(viewer);
}

/**
 * Ask the relays for anything new: on a timer, on focus, on reconnect, and
 * when a conversation opens.
 *
 * A backstop behind the standing subscription, and SHARED rather than merely
 * skipped — a conversation opening wants to know when the answer has landed,
 * not just that somebody else is asking, so every caller awaits the one read.
 * Cheap even so: every wrap it sees again is already in the seen memo, so the
 * cost is a REQ rather than a decryption.
 *
 * `signer` is only read when no pipeline is running; the running one's own is
 * used otherwise, being the fresher of the two.
 */
export function topUpDmInbox(
  viewer: string,
  signer?: InboxSigner,
): Promise<void> {
  const run = runs.get(viewer);
  const using = run?.signer ?? signer;
  if (!using) return Promise.resolve();
  if (run?.topUp) return run.topUp;

  const read: Promise<void> = (async () => {
    try {
      const relays = await inboxRelays(viewer, run);
      if (relays.length === 0) return;
      await syncDmInbox(viewer, using, {
        relays,
        pages: 2,
        // The run's own, when there is one: stopping the pipeline (logout)
        // must stop a top-up that is already inside the signer.
        ...(run ? { signal: run.abort.signal } : {}),
      });
    } catch (error) {
      console.warn("[dm] could not top up the inbox:", error);
    } finally {
      // Unconditional: nothing else can have stored a different top-up while
      // this one was in flight — every caller that arrived was handed THIS
      // promise rather than starting another.
      if (run) run.topUp = undefined;
    }
  })();

  if (run) run.topUp = read;
  return read;
}

/**
 * Fetch a page of the wrap stream older than `before`.
 *
 * DM history pages by WRAP, not by conversation: the inbox is one
 * undifferentiated stream and no relay can be asked for "older messages with
 * this person". So a conversation that has run out of local history asks for
 * the global page, and everyone reading gets whatever it turns up.
 *
 * Deduplicated by boundary, so two conversations that ran dry at the same
 * moment — or one reader clicking twice — pay for a single read.
 */
export function pageDmInboxBefore(
  viewer: string,
  before: number,
  signer?: InboxSigner,
): Promise<void> {
  const run = runs.get(viewer);
  const using = run?.signer ?? signer;
  if (!using) return Promise.resolve();

  const inFlight = run?.pages.get(before);
  if (inFlight) return inFlight;

  const read: Promise<void> = (async () => {
    try {
      const relays = await inboxRelays(viewer, run);
      if (relays.length === 0) return;
      await syncDmInbox(viewer, using, {
        relays,
        until: before,
        ...(run ? { signal: run.abort.signal } : {}),
      });
    } catch (error) {
      console.warn("[dm] could not page the inbox back:", error);
    } finally {
      run?.pages.delete(before);
    }
  })();

  run?.pages.set(before, read);
  return read;
}

/**
 * Walk it all again — for a new relay, or a run that went wrong.
 *
 * The caller clears the walk's own state first (`resetHistoryWalk`,
 * `resetLegacyImport`); this is what makes the pipeline notice. A no-op when
 * nothing is watching, because there is then nothing to restart.
 */
export function restartDmInbox(viewer: string): void {
  // Deliberately NOT gated on `refs > 0`. The hook releases and rejoins around
  // every list refresh, so the reference count is momentarily zero on any
  // ordinary tick — and a Rescan that landed in that window used to no-op
  // while `started` stayed true, which meant the walk state was cleared on disk
  // and nothing ever walked it again. A run inside its teardown grace is still
  // a run; the rejoin that follows clears the timer.
  const run = runs.get(viewer);
  if (!run) return;

  if (run.reopen !== undefined) clearTimeout(run.reopen);
  run.reopen = undefined;
  run.abort.abort();
  run.stopWatching?.();
  run.stopWatching = undefined;

  // A fresh promise, because the old one has already settled with the old set
  // and a reader waiting on it must not be handed relays this walk abandoned.
  run.settleRelays(undefined);
  run.relays = undefined;
  run.relaysReady = new Promise<string[] | undefined>((resolve) => {
    run.settleRelays = resolve;
  });

  run.abort = new AbortController();
  run.generation += 1;
  run.started = true;
  run.reopenAttempt = 0;
  void start(viewer, run, run.generation);
}

/** Reopen a standing subscription that ended under us, backing off as it recurs. */
function scheduleReopen(viewer: string, run: Run, gen: number): void {
  if (run.generation !== gen || run.abort.signal.aborted) return;
  if (run.reopen !== undefined) return;

  // A wire that stood for a minute and then dropped is a socket, not a refusal
  // — that one gets the short delay again.
  if (Date.now() - run.watchOpenedAt > WATCH_HEALTHY_MS) run.reopenAttempt = 0;
  const delay =
    REOPEN_DELAYS_MS[Math.min(run.reopenAttempt, REOPEN_DELAYS_MS.length - 1)];
  run.reopenAttempt += 1;

  console.warn(
    `[dm] reopening the inbox watch in ${Math.round(delay / 1000)}s`,
  );
  run.reopen = setTimeout(() => {
    run.reopen = undefined;
    if (run.generation !== gen || run.abort.signal.aborted) return;
    if (!run.relays) return;
    openWatch(viewer, run, gen, run.relays);
  }, delay);
}

function openWatch(
  viewer: string,
  run: Run,
  gen: number,
  relays: string[],
): void {
  run.stopWatching?.();
  run.watchOpenedAt = Date.now();
  run.stopWatching = watchDmInbox(viewer, run.signer, relays, {
    onClosed: () => scheduleReopen(viewer, run, gen),
  });
}

async function start(viewer: string, run: Run, gen: number): Promise<void> {
  const live = () => run.generation === gen && !run.abort.signal.aborted;

  // Resolved once and shared by the watch, the sync, the walk and every read a
  // conversation asks for: the callers disagreeing is how a wrap lands on a
  // relay only one of them was reading, and how the walk's relay-set signature
  // records a set that no read actually used.
  //
  // Retried, because failing here fails at everything — no relays means no
  // watch, and one bad moment at load would otherwise cost the session its live
  // wire. `started` is cleared on the way out so a later join tries again.
  let relays: string[] | undefined;
  for (let attempt = 0; attempt < RELAY_RESOLVE_ATTEMPTS && live(); attempt++) {
    try {
      const resolved = await ownDmReadRelays(viewer);
      if (resolved.length > 0) {
        relays = resolved;
        break;
      }
    } catch (error) {
      console.warn("[dm] could not resolve the inbox relays:", error);
    }
    if (attempt < RELAY_RESOLVE_ATTEMPTS - 1)
      await new Promise((resolve) => setTimeout(resolve, RELAY_RETRY_MS));
  }
  if (!live()) return;
  if (!relays) {
    console.warn("[dm] giving up on the inbox for now: no relays to read from");
    run.started = false;
    run.settleRelays(undefined);
    return;
  }
  run.relays = relays;
  run.settleRelays(relays);

  // The live wire goes up FIRST, and outside the try below. Started after the
  // catch-up, a sync that threw took the standing subscription with it and the
  // session ran on with a list that only moved when something remounted — every
  // message already on disk still there, so nothing looked broken until someone
  // said they had written. It is also the right order on its own terms: a wrap
  // arriving DURING the catch-up is caught rather than missed, and the
  // seen-wrap memo makes the overlap free.
  openWatch(viewer, run, gen, relays);

  try {
    // The fresh end first, so a reader who opens the pane sees today's mail
    // before a long walk starts.
    await syncDmInbox(viewer, run.signer, {
      relays,
      pages: 2,
      signal: run.abort.signal,
    });
    if (!live()) return;

    // Then the whole history, once PER RELAY SET. A wrap says nothing about
    // whose conversation it belongs to until it is open, so a complete
    // conversation list has no cheaper answer than opening everything — and
    // every wrap is opened once, ever, so this is a first-run cost. Passing the
    // relays is what makes adding one re-walk instead of silently doing nothing.
    if (!(await isHistoryExhausted(viewer, relays))) {
      await backfillDmHistory(viewer, run.signer, {
        relays,
        signal: run.abort.signal,
        onProgress: (walk) => {
          if (live())
            progressOf(viewer).next(walk.exhausted ? undefined : walk);
        },
      });
    }
    if (!live()) return;

    // Then the legacy plane, once. NIP-17 is young — most clients shipped it in
    // 2026 — so for anyone with history the kind-4 messages ARE the
    // conversation list, and they land in the same conversations, because a
    // kind-4 exchange with someone is the same conversation as the
    // gift-wrapped one.
    //
    // Skipped entirely without a follow list: the received direction is scoped
    // to follows, so importing with none would fetch your own half of every
    // conversation and nobody's replies — a stranger half-view is worse than
    // waiting for the list to load.
    if (run.signer.nip04 && !(await hasImportedLegacyDms(viewer))) {
      const follows = await followedPubkeys(viewer);
      if (live() && follows.length > 0)
        await importLegacyDms(viewer, run.signer, {
          follows,
          relays,
          signal: run.abort.signal,
          onProgress: (walk) => {
            if (live())
              progressOf(viewer).next({
                pages: 0,
                fetched: walk.fetched,
                written: walk.written,
                exhausted: walk.exhausted,
              });
          },
        });
    }
  } catch (error) {
    console.warn("[dm] could not sync the inbox:", error);
  } finally {
    if (live()) progressOf(viewer).next(undefined);
  }
}

/** Test seam. */
export function resetDmPipelines(): void {
  for (const [viewer, run] of [...runs]) {
    if (run.teardown !== undefined) clearTimeout(run.teardown);
    stop(viewer, run);
  }
  runs.clear();
  progress.clear();
}
