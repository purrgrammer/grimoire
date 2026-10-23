/**
 * Getting this account's gift wraps off the relays and into the store.
 *
 * Reads run on the SINGLETON pool, and they ANSWER NIP-42 — see
 * `dm-read-auth.ts`. That is the opposite of the publish path
 * (`dm-publish-pool.ts`) and deliberately so: this REQ asks the user's own
 * inbox relays for the user's own mail, most of which require authentication
 * before they will serve it, and identifying yourself to your own mailbox
 * discloses nothing it does not already hold. A read that does not answer the
 * challenge is indistinguishable from an empty inbox.
 *
 * Three things shape everything here:
 *
 * - **A wrap's `created_at` is randomised up to two days into the past** so its
 *   arrival time says nothing about when it was written. A cursor-based `since`
 *   therefore filters out almost every wrap that is genuinely new, which is why
 *   {@link WRAP_BACKDATE_SECS} exists and why the cursor is slack rather than
 *   exact.
 * - **Opening a wrap costs two `nip44.decrypt` calls.** Against a browser
 *   extension or a bunker that is two prompts or two round trips, per message,
 *   so a cold inbox of two hundred is four hundred of them. Hence the consent
 *   gate, the seen-wrap memo, and unlocking in small waves.
 * - **Nothing is decrypted twice, ever.** The rumor goes to Dexie and the wrap
 *   id to the seen table, including when it would not open — a wrap that failed
 *   once fails identically forever, and retrying it is a prompt per session for
 *   a message that does not exist.
 */

import { kinds } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import {
  unlockGiftWrap,
  lockGiftWrap,
  getGiftWrapSeal,
  getSealRumor,
  internalGiftWrapEvents,
} from "applesauce-common/helpers/gift-wrap";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import type { EncryptedContentSigner } from "applesauce-core/helpers/encrypted-content";
import { requestEvents } from "@/lib/relay-subscription";
import { ownDmReadRelays } from "@/lib/dm/relays";
import { authenticateDmRelays } from "./dm-read-auth";
import pool from "./relay-pool";
import {
  forgetFailedWraps,
  markWrapsSeen,
  readDmKv,
  seenWrapIds,
  writeDmKv,
  writeDmRumors,
} from "./dm-store";
import { DM_LIST_SCOPE, conversationScope, emitDmScopes } from "./dm-bus";

/** How far back a wrap's timestamp may be randomised (NIP-59 says two days). */
export const WRAP_BACKDATE_SECS = 2 * 24 * 3600;

/** Extra slack on top, for clock skew between us and the sender. */
export const WRAP_SINCE_SLACK_SECS = 3600;

/**
 * Wraps opened per wave, with a yield between waves.
 *
 * Armada's number, and its reasoning holds: a whole page unlocked as one
 * microtask chain blocks the main thread for seconds on noble's NIP-44, while
 * waves this small still keep a remote bunker's pipeline busy.
 */
export const DECRYPT_WAVE = 4;

/** Wraps per backfill page. */
export const BACKFILL_PAGE = 200;

const consentKey = (viewer: string) => `${viewer}:consent`;
const cursorKey = (viewer: string) => `${viewer}:cursor`;
const exhaustedKey = (viewer: string) => `${viewer}:exhausted`;
const walkedRelaysKey = (viewer: string) => `${viewer}:walked-relays`;

/** A relay set, in a form two of them can be compared by. */
const relaySignature = (relays: string[]) => [...relays].sort().join(" ");

/** Has this account agreed to have its inbox opened? */
export async function hasDecryptConsent(viewer: string): Promise<boolean> {
  return (await readDmKv<boolean>(consentKey(viewer))) === true;
}

/**
 * Record that the reader asked for their messages.
 *
 * Permanent for the account. The gate exists to stop a burst of signer prompts
 * nobody asked for, and once the reader has asked once, asking again every
 * session would be the same annoyance wearing a different hat.
 */
export async function grantDecryptConsent(viewer: string): Promise<void> {
  await writeDmKv(consentKey(viewer), true);
}

/** The oldest wrap timestamp this account has walked back to, if any. */
async function readCursor(viewer: string): Promise<number | undefined> {
  return readDmKv<number>(cursorKey(viewer));
}

/**
 * Whether the walk backwards has reached the end of what THESE relays hold.
 *
 * Sticky per account, but only for the relay set it was walked against.
 * Reaching the beginning is a fact about a particular set of relays, not about
 * the history in the abstract — a relay added afterwards holds mail this
 * account has never seen, and treating the walk as finished would make adding
 * one do nothing at all. Which is exactly what it did.
 *
 * Comparing the set rather than counting it: swapping one relay for another
 * changes what is reachable without changing how many there are.
 */
export async function isHistoryExhausted(
  viewer: string,
  relays?: string[],
): Promise<boolean> {
  if ((await readDmKv<boolean>(exhaustedKey(viewer))) !== true) return false;
  if (!relays) return true;

  const walked = await readDmKv<string>(walkedRelaysKey(viewer));
  return walked === relaySignature(relays);
}

/**
 * Walk the history again from the top — for a bad first run, or a hunch.
 *
 * Also forgets every wrap that would not open. The attempt cap exists so a
 * genuinely malformed wrap is not retried forever, but it cannot tell that
 * apart from a signer that was refusing, timing out, or rate-limiting — and
 * because a sync runs on mount AND on every conversation open, three attempts
 * can burn in under a minute. This is the escape hatch for that, and it is the
 * whole reason the reader is pressing the button.
 */
export async function resetHistoryWalk(viewer: string): Promise<void> {
  await writeDmKv(exhaustedKey(viewer), false);
  await writeDmKv(cursorKey(viewer), undefined);
  await writeDmKv(walkedRelaysKey(viewer), undefined);
  const forgotten = await forgetFailedWraps(viewer);
  if (forgotten > 0)
    console.info(`[dm] will try ${forgotten} unopened wrap(s) again`);
}

/** A signer that can open a wrap. Absent `nip44` means it cannot. */
export type DmSigner = EncryptedContentSigner;

export interface UnlockOutcome {
  /** Rumors written to the store. */
  written: number;
  /** Wraps that would not open, and never will. */
  failed: number;
}

/**
 * How long ONE relay gets to answer a DM read.
 *
 * Generous on purpose. An auth-gated relay has to send a challenge, wait for a
 * signature — possibly from a bunker, possibly behind a human clicking a
 * prompt — and only then serve the re-issued REQ. The default one-shot bound
 * is ten seconds, which cuts that handshake off in the middle and looks
 * exactly like an empty inbox.
 */
const RELAY_READ_TIMEOUT_MS = 25_000;

/**
 * Read one page from each relay SEPARATELY, and say what each one gave.
 *
 * Not a pooled group read, for the reason armada documents: a group applies
 * one deadline to the whole fan-out, so the first relay to answer starts a
 * clock the auth-gated ones cannot beat — and a relay that is mid-NIP-42
 * handshake contributes nothing while looking indistinguishable from a relay
 * with no mail on it.
 *
 * The per-relay counts are the only thing that answers "why is my
 * conversation list short". A total cannot: eleven wraps from four relays
 * reads as an empty inbox, when what actually happened is that three of them
 * refused and one served everything it had.
 */
interface RelayPage {
  relay: string;
  events: NostrEvent[];
  /** The relay answered. False means it threw, timed out, or refused. */
  answered: boolean;
}

export interface WrapPage {
  wraps: NostrEvent[];
  pages: RelayPage[];
  /** Any relay answered at all. False means the read told us nothing. */
  answered: boolean;
  /**
   * The oldest timestamp it is safe to walk back to, or undefined.
   *
   * The MAX of the per-relay page tails — not the min over the merged union,
   * which is the bug this replaces. Relay A returns 200 wraps down to last
   * week; relay B holds five old ones down to 2023. Taking the minimum sets
   * `until` to 2023, and relay A is never asked for anything in between —
   * which on a busy relay is most of its history.
   *
   * Deliberately NOT filtered to relays that filled their page. A relay that
   * silently caps below the requested limit returns a short page that looks
   * identical to running out, so treating short as spent walks straight past
   * everything behind the cap. Termination is the dedupe's job instead.
   */
  nextUntil?: number;
}

async function readWrapsPerRelay(
  relays: string[],
  filter: Record<string, unknown>,
  label: string,
): Promise<WrapPage> {
  const pages = await Promise.all(
    relays.map(async (relay): Promise<RelayPage> => {
      try {
        const events = await requestEvents([relay], [filter as never], {
          eventStore: null,
          timeout: RELAY_READ_TIMEOUT_MS,
        });
        return { relay, events, answered: true };
      } catch (error) {
        console.warn(`[dm] ${relay} failed:`, error);
        return { relay, events: [], answered: false };
      }
    }),
  );

  for (const { relay, events, answered } of pages)
    console.info(
      `[dm] ${label}: ${relay} → ${answered ? `${events.length} wraps` : "no answer"}`,
    );

  const merged = new Map<string, NostrEvent>();
  for (const { events } of pages)
    for (const event of events) merged.set(event.id, event);

  let nextUntil: number | undefined;
  for (const { events } of pages) {
    if (events.length === 0) continue;
    const tail = events.reduce(
      (min, e) => Math.min(min, e.created_at),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(tail)) continue;
    if (nextUntil === undefined || tail > nextUntil) nextUntil = tail;
  }

  return {
    wraps: [...merged.values()],
    pages,
    answered: pages.some((p) => p.answered),
    ...(nextUntil !== undefined ? { nextUntil } : {}),
  };
}

/**
 * Open wraps, in waves, and write what comes out.
 *
 * Wraps not addressed to `viewer` are dropped before the signer is touched:
 * they can never open, and every attempt is a wasted prompt. Own sends land
 * here too — the self-copy comes back from the relay — but `dm/send.ts` has
 * already marked those seen, so they cost nothing.
 */
export async function unlockWraps(
  viewer: string,
  signer: DmSigner,
  wraps: NostrEvent[],
  signal?: AbortSignal,
): Promise<UnlockOutcome> {
  if (signal?.aborted) return { written: 0, failed: 0 };
  const addressed = wraps.filter(
    (wrap) =>
      wrap.kind === kinds.GiftWrap &&
      wrap.tags.some((t) => t[0] === "p" && t[1] === viewer),
  );

  // Within the batch first. `{ eventStore: null }` disables applesauce's
  // cross-relay dedupe, so four inbox relays hand us the same wrap four times
  // — which without this is four times the signer calls.
  const unique = new Map<string, NostrEvent>();
  for (const wrap of addressed)
    if (!unique.has(wrap.id)) unique.set(wrap.id, wrap);

  const seen = await seenWrapIds(viewer, [...unique.keys()]);
  const todo = [...unique.values()].filter(
    (w) => !seen.has(w.id) && !inFlight.has(`${viewer}:${w.id}`),
  );
  if (todo.length === 0) return { written: 0, failed: 0 };

  // And across concurrent calls. `watchDmInbox` fires one `unlockWraps` per
  // arriving wrap per relay, and they all read `seenWrapIds` before any of
  // them has written it back.
  for (const wrap of todo) inFlight.add(`${viewer}:${wrap.id}`);
  try {
    return await openAndStore(viewer, signer, todo, signal);
  } finally {
    for (const wrap of todo) inFlight.delete(`${viewer}:${wrap.id}`);
  }
}

/** Wraps being opened right now, so two callers cannot both open one. */
const inFlight = new Set<string>();

async function openAndStore(
  viewer: string,
  signer: DmSigner,
  todo: NostrEvent[],
  signal?: AbortSignal,
): Promise<UnlockOutcome> {
  let stored = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i += DECRYPT_WAVE) {
    if (signal?.aborted) break;
    const wave = todo.slice(i, i + DECRYPT_WAVE);
    const rumors: Rumor[] = [];
    const marks: Array<{ id: string; created_at: number; opened: boolean }> =
      [];

    await Promise.all(
      wave.map(async (wrap) => {
        let opened = false;
        try {
          rumors.push(await unlockGiftWrap(wrap, signer));
          opened = true;
        } catch {
          failed += 1;
        }
        discardPlaintext(wrap);
        marks.push({ id: wrap.id, created_at: wrap.created_at, opened });
      }),
    );

    // Stopped while the signer was working — a logout, a rescan, a pipeline
    // torn down. Nothing is written and nothing is marked: `stopDmInbox` runs
    // BEFORE the logout wipe, so a wave that was already inside `decrypt` would
    // otherwise write plaintext into the tables the wipe has just emptied, or
    // leave seen marks for rows the wipe took — and a seen mark with no row is
    // a message that never comes back. Unmarked wraps simply open next time.
    if (signal?.aborted) break;

    // WRITE, then mark seen — in that order, and per wave.
    //
    // Both halves matter. Marking a batch seen and writing it once at the end
    // meant an abort in between left wraps recorded as opened with no row to
    // show for it, and `seenWrapIds` never hands those back: decrypted
    // messages, gone permanently. Doing it per wave bounds that to nothing,
    // because the write now precedes the mark. And marking per wave rather
    // than per batch is what stopped one malformed wrap from making a whole
    // page decryptable-again forever.
    const { written, touched } = await writeDmRumors(viewer, rumors);
    stored += written.length;
    if (signal?.aborted) break;
    await markWrapsSeen(viewer, marks);

    // Store first, doorbell second. A missed ring is a stale render; a ring
    // before the write is a reader that looks and finds nothing.
    if (touched.length > 0)
      emitDmScopes([DM_LIST_SCOPE, ...touched.map(conversationScope)]);

    // Let the browser paint between waves.
    if (i + DECRYPT_WAVE < todo.length)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { written: stored, failed };
}

/**
 * Get the decrypted message out of memory once Dexie has it.
 *
 * `lockGiftWrap` alone is not enough, and its name oversells it twice over.
 * It drops the symbol references on the wrap, but every seal and rumor it ever
 * derived stays in applesauce's module-level `internalGiftWrapEvents` — an
 * `EventMemory` over an LRU constructed with no bound, so nothing is ever
 * evicted and a logout cannot reach it. Worse, it re-derives the seal to find
 * what to lock, which re-runs `JSON.parse` on plaintext that already failed to
 * parse — so on a malformed wrap it throws on the way out.
 *
 * The rumor is the entry that holds the message body, and it is added by
 * `getSealRumor` rather than by anything that takes a wrap — so evicting the
 * wrap is a no-op and evicting the seal does not reach it. All three are
 * handled here, and none of it is allowed to throw.
 */
function discardPlaintext(wrap: NostrEvent): void {
  try {
    const seal = getGiftWrapSeal(wrap);
    if (!seal) return;
    // The RUMOR is the entry that matters: `getSealRumor` adds it to the
    // memory, and it is the one holding the message body in cleartext. Evict
    // it first, because evicting the seal does not reach it.
    try {
      // By id: a rumor is unsigned, and `remove` takes an id or a full event.
      const rumor = getSealRumor(seal);
      if (rumor?.id) internalGiftWrapEvents.remove(rumor.id);
    } catch {
      // A seal that will not parse produced no rumor.
    }
    internalGiftWrapEvents.remove(seal);
  } catch {
    // A wrap that will not parse has no seal to evict.
  } finally {
    try {
      lockGiftWrap(wrap);
    } catch {
      // `lockGiftWrap` re-derives to find what to clear, and re-derivation is
      // exactly what fails on the wraps that need clearing most.
    }
  }
}

/** The filter for this account's mail, with the backdating slack applied. */
export function inboxFilter(viewer: string, since?: number) {
  return {
    kinds: [kinds.GiftWrap],
    "#p": [viewer],
    ...(since !== undefined
      ? { since: since - WRAP_BACKDATE_SECS - WRAP_SINCE_SLACK_SECS }
      : {}),
  };
}

export interface SyncOptions {
  /** Override the relay set. Resolved from the account's lists otherwise. */
  relays?: string[];
  /** Walk backwards from here instead of fetching the newest page. */
  until?: number;
  limit?: number;
  /**
   * How many pages to walk backwards before stopping.
   *
   * One page is the newest {@link BACKFILL_PAGE} wraps a relay will serve, and
   * a wrap says nothing about which conversation it belongs to until it is
   * open — so a single page of an active inbox can be one correspondent
   * repeated two hundred times while the rest of the list stays invisible.
   * Walking a few pages on the first load is what makes the sidebar look like
   * the reader's actual mail.
   */
  pages?: number;
  /** Stops the pass between pages and between decrypt waves. */
  signal?: AbortSignal;
}

/**
 * One pass: fetch wraps, open them, store them.
 *
 * Returns the outcome plus the oldest wrap seen, which is what a caller pages
 * `until` on. Note that DM history pages by WRAP, not by conversation — the
 * stream is one undifferentiated inbox and there is no way to ask a relay for
 * "older messages with this person".
 */
export async function syncDmInbox(
  viewer: string,
  signer: DmSigner,
  options: SyncOptions = {},
): Promise<UnlockOutcome & { oldest?: number; fetched: number }> {
  const relays = options.relays ?? (await ownDmReadRelays(viewer));
  if (relays.length === 0) return { written: 0, failed: 0, fetched: 0 };

  const limit = options.limit ?? BACKFILL_PAGE;
  const pages = Math.max(1, options.pages ?? 1);

  // Held for the whole walk, not per page. The challenge usually arrives AFTER
  // the first REQ — the REQ is what opens the socket — and applesauce retries
  // the refused REQ once the relay reports itself authenticated.
  const auth = authenticateDmRelays(relays);

  let written = 0;
  let failed = 0;
  let fetched = 0;
  let oldest: number | undefined;
  let until = options.until;

  // Released on every exit. A store error out of `unlockWraps` used to skip the
  // unsubscribe and leave the NIP-42 responder attached to those relays for the
  // life of the page.
  try {
    for (let page = 0; page < pages; page += 1) {
      if (options.signal?.aborted) break;

      const filter = {
        ...inboxFilter(viewer),
        limit,
        ...(until !== undefined ? { until } : {}),
      };

      const page_ = await readWrapsPerRelay(relays, filter, `page ${page + 1}`);
      if (page_.wraps.length === 0) break;

      const outcome = await unlockWraps(
        viewer,
        signer,
        page_.wraps,
        options.signal,
      );
      written += outcome.written;
      failed += outcome.failed;
      fetched += page_.wraps.length;

      // Loud on purpose, once per page. Every question anyone has asked about a
      // short conversation list — is it the relays, the decryption, or the
      // store refusing rows — is answered by these numbers, and none of them
      // is visible from the UI.
      console.info(
        `[dm] page ${page + 1}: ${page_.wraps.length} wraps → ` +
          `${outcome.written} stored, ${outcome.failed} would not open, ` +
          `${page_.wraps.length - outcome.written - outcome.failed} already known`,
      );

      const pageOldest = page_.wraps.reduce<number | undefined>(
        (min, w) =>
          min === undefined || w.created_at < min ? w.created_at : min,
        undefined,
      );
      if (
        pageOldest !== undefined &&
        (oldest === undefined || pageOldest < oldest)
      )
        oldest = pageOldest;

      // The MAX of the per-relay tails — see `readWrapsPerRelay`. Undefined
      // means no relay returned anything.
      if (page_.nextUntil === undefined) break;
      // Strictly older next time, or a relay that ignores `until` makes this
      // loop `pages` round trips for one page of history.
      if (until !== undefined && page_.nextUntil >= until) break;
      until = page_.nextUntil;
    }
  } finally {
    auth.unsubscribe();
  }

  // Deliberately NO cursor write here. The cursor is the resume point of the
  // sequential history walk (`backfillDmHistory`) and nothing else, and this
  // pass is not that walk: it fetches the newest page, or an arbitrary page a
  // conversation asked for. Recording `oldest` — the minimum over the MERGED
  // pages — let one shallow relay holding a 2023 wrap drag the cursor to 2023
  // on every top-up, and the walk then resumed from there and never read
  // anything between its real frontier and that point.

  console.info(
    `[dm] sync done: ${fetched} wraps seen, ${written} stored, ${failed} unopenable — relays: ${relays.join(", ")}`,
  );

  return {
    written,
    failed,
    fetched,
    ...(oldest !== undefined ? { oldest } : {}),
  };
}

export interface BackfillProgress {
  /** Pages walked so far. */
  pages: number;
  /** Wraps the relays have handed over. */
  fetched: number;
  /** Messages stored. Lower than `fetched`: most pages are mostly re-runs. */
  written: number;
  /** The walk reached the beginning of what the relays hold. */
  exhausted: boolean;
}

/**
 * Walk this account's whole gift-wrap history, oldest-ward, until it runs dry.
 *
 * A DM inbox is one undifferentiated stream: a wrap says nothing about whose
 * conversation it belongs to until it is open, so "show me my conversations"
 * has no cheaper answer than "open everything". One page of an active inbox
 * can be a single correspondent repeated two hundred times while everyone else
 * stays invisible — which is exactly what a short conversation list looks like.
 *
 * Three properties make that affordable rather than reckless:
 *
 * - **Resumable.** The cursor records how far back the walk has got and only
 *   ever recedes, so a reload continues rather than restarting. Reaching the
 *   beginning is recorded too, and is sticky.
 * - **Paid once.** Every wrap opened is mirrored, and the seen memo covers the
 *   ones that would not open — so the expensive run is the first one, and
 *   every run after it is a handful of pages of already-known ids.
 * - **Interruptible.** The walk yields between pages and stops on `signal`, so
 *   closing the window does not leave it grinding.
 *
 * It rings the doorbell as it goes, so the list fills in while it runs rather
 * than appearing all at once at the end.
 */
export async function backfillDmHistory(
  viewer: string,
  signer: DmSigner,
  options: {
    relays?: string[];
    /** Stop after this many pages. Absent means walk to the end. */
    maxPages?: number;
    signal?: AbortSignal;
    onProgress?: (progress: BackfillProgress) => void;
  } = {},
): Promise<BackfillProgress> {
  const relays = options.relays ?? (await ownDmReadRelays(viewer));
  const progress: BackfillProgress = {
    pages: 0,
    fetched: 0,
    written: 0,
    exhausted: false,
  };
  if (relays.length === 0) return progress;

  // Same as the page sync: the auth has to outlive each individual read,
  // because the challenge arrives on the socket the read opened.
  const auth = authenticateDmRelays(relays);
  try {
    // From the top when the relay set has changed: the cursor records how far
    // back the OLD relays were walked, and starting a new relay there skips
    // everything it holds that is newer than that point.
    //
    // Recorded HERE, not on exhaustion. Writing it only at the end meant every
    // run before the first completed walk saw a mismatched signature, cleared
    // the cursor, and started from the newest page again — so an inbox needing
    // more pages than one sitting never got deeper, and the "resumable" in the
    // docstring above was not true of the code.
    const signature = relaySignature(relays);
    const sameRelays =
      (await readDmKv<string>(walkedRelaysKey(viewer))) === signature;
    let until = sameRelays ? await readCursor(viewer) : undefined;
    if (!sameRelays) {
      await writeDmKv(cursorKey(viewer), undefined);
      await writeDmKv(walkedRelaysKey(viewer), signature);
    }
    // Ids this walk has already been handed. A relay that ignores `until` — or
    // one whose page cap is filled by the boundary wrap alone — would otherwise
    // serve the same page forever, and the walk would never end.
    const seenThisWalk = new Set<string>();
    /**
     * Whether the last page came back with nothing new.
     *
     * `until` is inclusive, so the wrap the bound was taken from comes back in
     * the next page. That is deliberate — an exclusive bound would drop its
     * same-second siblings — but it means a page can be entirely repeats while
     * older wraps still exist behind the relay's page cap. One strict step past
     * the boundary distinguishes "the cap hid the rest" from "there is no rest";
     * two in a row means there is genuinely nothing older.
     */
    let steppedPast = false;

    while (!options.signal?.aborted) {
      if (options.maxPages !== undefined && progress.pages >= options.maxPages)
        break;

      const page = await readWrapsPerRelay(
        relays,
        {
          ...inboxFilter(viewer),
          limit: BACKFILL_PAGE,
          ...(until !== undefined ? { until } : {}),
        },
        `backfill page ${progress.pages + 1}`,
      );

      progress.pages += 1;

      // A read where NOTHING answered says nothing about the history. Treating
      // it as the end is how a walk latches `exhausted` on a cold start where
      // every auth-gated relay was still waiting on the signer — and then never
      // runs again. Stop, but do not record an ending.
      if (!page.answered) {
        console.info("[dm] backfill paused: no relay answered");
        break;
      }

      if (page.wraps.length === 0) {
        progress.exhausted = true;
        break;
      }

      const fresh = page.wraps.filter((w) => !seenThisWalk.has(w.id));
      for (const wrap of page.wraps) seenThisWalk.add(wrap.id);

      if (fresh.length === 0) {
        if (steppedPast || until === undefined) {
          // Stepping past the boundary changed nothing: there is nothing older.
          progress.exhausted = true;
          break;
        }
        // Everything in this page was already seen. Either the relay is ignoring
        // the bound, or its page cap was filled by the boundary wrap's own
        // second — one strict step tells us which. The cost, in the pathological
        // case where a whole page shares one timestamp, is the rest of that
        // second; the alternative is a walk that does not terminate.
        steppedPast = true;
        until -= 1;
        continue;
      }
      steppedPast = false;

      const outcome = await unlockWraps(viewer, signer, fresh, options.signal);
      // Stopped partway through the page. Its wraps were not all opened, so the
      // cursor must NOT move past them — recording the boundary here would make
      // the next run resume beyond mail it never read.
      if (options.signal?.aborted) break;
      progress.fetched += fresh.length;
      progress.written += outcome.written;

      // The MAX of the tails among relays that filled their page, so a shallow
      // relay cannot drag the bound past a deep one's unread history. Undefined
      // means every relay returned a short page: they are all spent.
      const pageOldest = page.nextUntil;
      if (pageOldest === undefined) {
        progress.exhausted = true;
        break;
      }

      // Inclusive, so a run of same-second wraps is not split across the bound;
      // `seenThisWalk` is what stops that from looping.
      until = pageOldest;
      await writeDmKv(cursorKey(viewer), pageOldest);

      console.info(
        `[dm] backfill page ${progress.pages}: ${fresh.length} new wraps, ` +
          `${outcome.written} stored, back to ${new Date(pageOldest * 1000).toISOString()}`,
      );
      options.onProgress?.({ ...progress });

      // Between pages, not inside them: the decrypt waves already yield, and
      // this is what keeps the window responsive across a long walk.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    // On every exit — a store error mid-walk used to leave the responder
    // attached to these relays for the life of the page.
    auth.unsubscribe();
  }

  // The signature was recorded when the walk STARTED, so this only has to say
  // that it reached the end. Never for a walk that was stopped: a page that was
  // cut short is not an ending.
  if (progress.exhausted && !options.signal?.aborted)
    await writeDmKv(exhaustedKey(viewer), true);
  options.onProgress?.({ ...progress });
  console.info(
    `[dm] backfill ${progress.exhausted ? "complete" : "paused"}: ` +
      `${progress.pages} pages, ${progress.fetched} wraps, ${progress.written} stored`,
  );
  return progress;
}

/**
 * Watch for new wraps until unsubscribed.
 *
 * No `since`: the standing REQ opens with the relay's own recent window, and
 * the seen-wrap memo makes a replayed wrap free. Trying to be clever with a
 * cursor here is what the backdating defeats.
 *
 * A stream that ends is reported rather than swallowed. Nothing here reopens
 * it — this owns one subscription and says when it is gone; reopening is the
 * pipeline's job (`dm-pipeline.ts`), which is what knows whether anyone is
 * still watching. An unnoticed end is the worst failure this file has: the
 * inbox stays exactly as correct as it looks, and stops growing.
 */
export function watchDmInbox(
  viewer: string,
  signer: DmSigner,
  relays: string[],
  options: { onClosed?: (reason: "error" | "complete") => void } = {},
): () => void {
  const auth = authenticateDmRelays(relays);
  console.info(`[dm] watching ${relays.length} relay(s) for new wraps`);
  let stopped = false;
  // Handed to every unlock this watch starts, so stopping it also stops the
  // ones already inside the signer — see `openAndStore`.
  const stop = new AbortController();
  const subscription = pool
    .subscription(relays, [inboxFilter(viewer)], { eventStore: null })
    .subscribe({
      next: (wrap) => {
        // Caught: this is a fire-and-forget call out of a subscription, and a
        // store error here would otherwise be an unhandled rejection per wrap.
        unlockWraps(viewer, signer, [wrap], stop.signal).catch((error) => {
          console.warn("[dm] could not open a live wrap:", error);
        });
      },
      error: (error) => {
        console.warn("[dm] the inbox watch stopped on an error:", error);
        if (!stopped) options.onClosed?.("error");
      },
      complete: () => {
        console.warn("[dm] the inbox watch completed — no more live wraps");
        if (!stopped) options.onClosed?.("complete");
      },
    });

  return () => {
    // Before unsubscribing: a deliberate stop must not look like a stream that
    // died, or the pipeline reopens the wire it was just told to close.
    stopped = true;
    stop.abort();
    subscription.unsubscribe();
    auth.unsubscribe();
  };
}
