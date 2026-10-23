import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrivateKeySigner } from "applesauce-signers";
import {
  GiftWrapFactory,
  WrappedMessageFactory,
} from "applesauce-common/factories";
import { finalizeEvent, generateSecretKey, kinds } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import db from "./db";
import { listDmConversations, queryConversation } from "./dm-store";
import {
  backfillDmHistory,
  DECRYPT_WAVE,
  grantDecryptConsent,
  hasDecryptConsent,
  inboxFilter,
  isHistoryExhausted,
  resetHistoryWalk,
  syncDmInbox,
  unlockWraps,
  WRAP_BACKDATE_SECS,
} from "./dm-inbox";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";
import * as subscription from "@/lib/relay-subscription";
import { DM_WRAP_MAX_ATTEMPTS } from "./dm-store";

/**
 * Ingest is where the cost of NIP-17 lives: two `nip44.decrypt` calls per
 * message, against a signer that may be a browser prompt or a remote bunker.
 * Every test here is about not paying that twice, or paying it for mail that
 * was never ours.
 */

const alice = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000001",
);
const bob = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000002",
);

let ALICE = "";
let BOB = "";

const relays: MockRelay[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

/**
 * As a relay would hand it over: a fresh object with no symbols on it.
 *
 * `GiftWrapFactory` leaves the plaintext cached on the wrap it built, so a
 * locally-created wrap opens without decrypting anything — which makes any
 * test that counts signer calls silently measure nothing.
 */
function overTheWire(wrap: NostrEvent): NostrEvent {
  return JSON.parse(JSON.stringify(wrap)) as NostrEvent;
}

/** A real NIP-17 wrap: rumor from `from`, sealed and wrapped to `to`. */
async function wrapMessage(
  from: PrivateKeySigner,
  to: string,
  content: string,
): Promise<NostrEvent> {
  const rumor = await WrappedMessageFactory.create([to], content)
    .as(from)
    .stamp();
  return GiftWrapFactory.create(from, to, rumor);
}

beforeEach(async () => {
  ALICE = await alice.getPublicKey();
  BOB = await bob.getPublicKey();
  await db.dmRumors.clear();
  await db.dmConversations.clear();
  await db.dmSeenWraps.clear();
  await db.dmKv.clear();
});

afterEach(async () => {
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

describe("the consent gate", () => {
  it("starts closed and stays open once asked", async () => {
    expect(await hasDecryptConsent(ALICE)).toBe(false);
    await grantDecryptConsent(ALICE);
    expect(await hasDecryptConsent(ALICE)).toBe(true);
  });

  it("is per account", async () => {
    await grantDecryptConsent(ALICE);
    expect(await hasDecryptConsent(BOB)).toBe(false);
  });
});

describe("inboxFilter", () => {
  it("backdates `since` past the window a wrap may be randomised into", () => {
    const since = 1_000_000;
    const filter = inboxFilter(ALICE, since);
    // A wrap written now can carry a timestamp two days old. A cursor-exact
    // `since` would filter out nearly every genuinely new message — the classic
    // "DMs only arrive after a full resync" bug.
    expect(filter.since).toBeLessThanOrEqual(since - WRAP_BACKDATE_SECS);
  });

  it("omits `since` entirely when there is no cursor", () => {
    expect(inboxFilter(ALICE)).not.toHaveProperty("since");
  });
});

describe("unlockWraps", () => {
  it("opens a wrap and stores the message inside it", async () => {
    const wrap = await wrapMessage(bob, ALICE, "hello alice");

    const outcome = await unlockWraps(ALICE, alice, [wrap]);

    expect(outcome).toMatchObject({ written: 1, failed: 0 });
    const [conversation] = await listDmConversations(ALICE);
    const rows = await queryConversation(ALICE, conversation.conversationId, {
      limit: 10,
    });
    expect(rows[0].content).toBe("hello alice");
    expect(rows[0].pubkey).toBe(BOB);
  });

  it("never asks the signer twice for the same wrap", async () => {
    const wrap = await wrapMessage(bob, ALICE, "once");
    await unlockWraps(ALICE, alice, [wrap]);

    // The seen memo is what makes a cold reload free. Without it every session
    // re-opens the whole inbox, which on a bunker is a prompt per message.
    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    const outcome = await unlockWraps(ALICE, alice, [wrap]);

    expect(decrypt).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ written: 0, failed: 0 });
    decrypt.mockRestore();
  });

  it("never asks the signer about a wrap addressed to someone else", async () => {
    const notMine = await wrapMessage(alice, BOB, "for bob");

    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    const outcome = await unlockWraps(ALICE, alice, [notMine]);

    expect(decrypt).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ written: 0, failed: 0 });
    decrypt.mockRestore();
  });

  it("gives up on a wrap that will not open, but not on the first try", async () => {
    // Two very different things fail the same way here. A malformed wrap — and
    // a p tag is public, so anyone can address one to us — fails identically
    // forever, and retrying it is a signer prompt per session for a message
    // that does not exist. But a signer that timed out, was dismissed, or rate
    // limited a burst also fails, and writing those off permanently deletes
    // real mail. So: retried, then given up on.
    const garbage = finalizeEvent(
      {
        kind: kinds.GiftWrap,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", ALICE]],
        content: "not ciphertext anyone can read",
      },
      generateSecretKey(),
    );

    for (let attempt = 1; attempt <= DM_WRAP_MAX_ATTEMPTS; attempt += 1) {
      const outcome = await unlockWraps(ALICE, alice, [garbage]);
      expect(outcome).toMatchObject({ written: 0, failed: 1 });
    }

    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    const afterwards = await unlockWraps(ALICE, alice, [garbage]);
    expect(decrypt).not.toHaveBeenCalled();
    expect(afterwards).toMatchObject({ written: 0, failed: 0 });
    decrypt.mockRestore();
  });

  it("tries again after a signer that failed everything comes back", async () => {
    // The symptom this exists to stop: a bunker times out mid-backlog and the
    // conversations it was carrying are gone for good.
    const wraps = await Promise.all([
      wrapMessage(bob, ALICE, "one"),
      wrapMessage(bob, ALICE, "two"),
    ]).then((w) => w.map(overTheWire));

    const broken = vi
      .spyOn(alice.nip44, "decrypt")
      .mockRejectedValue(new Error("signer timed out"));
    expect(await unlockWraps(ALICE, alice, wraps)).toMatchObject({
      written: 0,
      failed: 2,
    });
    broken.mockRestore();

    expect(await unlockWraps(ALICE, alice, wraps)).toMatchObject({
      written: 2,
    });
  });

  it("keeps a rumor about other people out of our store", async () => {
    // Someone can wrap a conversation between two strangers and address the
    // OUTER wrap to us. It opens; it is still not our mail, and it would show
    // up as a conversation we cannot answer.
    const rumor = await WrappedMessageFactory.create([BOB], "between us")
      .as(bob)
      .stamp();
    const misdirected = await GiftWrapFactory.create(bob, ALICE, rumor);

    const outcome = await unlockWraps(ALICE, alice, [misdirected]);

    expect(outcome.written).toBe(0);
    expect(await listDmConversations(ALICE)).toEqual([]);
  });

  it("yields between waves instead of blocking on a whole page", async () => {
    const wraps = await Promise.all(
      Array.from({ length: DECRYPT_WAVE * 2 + 1 }, (_, i) =>
        wrapMessage(bob, ALICE, `m${i}`),
      ),
    );

    let concurrent = 0;
    let peak = 0;
    const decrypt = vi
      .spyOn(alice.nip44, "decrypt")
      .mockImplementation(async (...args) => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        try {
          return await PrivateKeySigner.prototype.nip44.decrypt.apply(
            alice,
            args,
          );
        } finally {
          concurrent -= 1;
        }
      });

    await unlockWraps(ALICE, alice, wraps);

    // Two decrypts per wrap (wrap then seal), but the seal's only starts after
    // its wrap's resolves, so a wave is at most DECRYPT_WAVE in flight.
    expect(peak).toBeLessThanOrEqual(DECRYPT_WAVE);
    decrypt.mockRestore();
  });
});

describe("wraps that fight back", () => {
  it("records a malformed wrap instead of losing the whole batch to it", async () => {
    // `unlockGiftWrap` caches the plaintext on the wrap BEFORE parsing it, and
    // `lockGiftWrap` re-derives the seal to find what to clear — so on a wrap
    // whose plaintext is not JSON it throws on the way out too. Thrown from a
    // `finally` that used to sit inside `Promise.all`, that took down the whole
    // wave and with it every markWrapsSeen: two signer prompts per message,
    // every session, forever. Anyone who knows a pubkey can craft one.
    const poison = await GiftWrapFactory.create(
      bob,
      ALICE,
      // A "rumor" that decrypts to something that is not an event.
      { kind: 14, created_at: 1, tags: [], content: "x", pubkey: BOB, id: "x" },
    );
    const broken = {
      ...poison,
      content: await bob.nip44.encrypt(ALICE, "this is not json"),
    } as NostrEvent;
    const good = await wrapMessage(bob, ALICE, "survives");

    const outcome = await unlockWraps(ALICE, alice, [broken, good]);

    expect(outcome.written).toBe(1);
    // Both recorded, so neither is opened again.
    expect(await db.dmSeenWraps.count()).toBe(2);
  });

  it("opens a wrap once even when four relays deliver it", async () => {
    // `{ eventStore: null }` disables applesauce's cross-relay dedupe, so the
    // same wrap arrives once per inbox relay. Without a batch-level dedupe a
    // cold inbox costs its size times the relay count in signer calls.
    const wrap = await wrapMessage(bob, ALICE, "delivered four times");
    const copies = [1, 2, 3, 4].map(() => overTheWire(wrap));

    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    await unlockWraps(ALICE, alice, copies);

    // Two per wrap: the wrap, then the seal.
    expect(decrypt).toHaveBeenCalledTimes(2);
    decrypt.mockRestore();
  });

  it("opens a wrap once even when two callers race for it", async () => {
    // `watchDmInbox` fires one call per arriving wrap per relay, and all of
    // them read the seen table before any of them writes it.
    const wrap = await wrapMessage(bob, ALICE, "raced");

    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    await Promise.all([
      unlockWraps(ALICE, alice, [overTheWire(wrap)]),
      unlockWraps(ALICE, alice, [overTheWire(wrap)]),
    ]);

    expect(decrypt).toHaveBeenCalledTimes(2);
    decrypt.mockRestore();
  });
});

describe("syncDmInbox", () => {
  it("fetches from the relay and stores what it opens", async () => {
    const wrap = await wrapMessage(bob, ALICE, "over the wire");
    const r = await relay({ kind: "normal", events: [wrap] });

    const result = await syncDmInbox(ALICE, alice, { relays: [r.url] });

    expect(result).toMatchObject({ fetched: 1, written: 1 });
    expect(await listDmConversations(ALICE)).toHaveLength(1);
  });

  it("does nothing when the account has nowhere to read from", async () => {
    const result = await syncDmInbox(ALICE, alice, { relays: [] });
    expect(result).toMatchObject({ fetched: 0, written: 0 });
  });

  it("leaves the walk's resume cursor alone", async () => {
    // The cursor belongs to `backfillDmHistory`. A top-up reports the MINIMUM
    // over its merged pages, so one shallow relay holding an ancient wrap used
    // to drag the cursor there and the walk resumed past everything between.
    const wrap = await wrapMessage(bob, ALICE, "old");
    const r = await relay({ kind: "normal", events: [wrap] });
    await db.dmKv.put({ key: `${ALICE}:cursor`, value: 1 });

    await syncDmInbox(ALICE, alice, { relays: [r.url] });

    expect((await db.dmKv.get(`${ALICE}:cursor`))?.value).toBe(1);
  });

  it("opens nothing once it has been told to stop", async () => {
    const wrap = await wrapMessage(bob, ALICE, "too late");
    const r = await relay({ kind: "normal", events: [wrap] });
    const stop = new AbortController();
    stop.abort();

    const result = await syncDmInbox(ALICE, alice, {
      relays: [r.url],
      signal: stop.signal,
    });

    expect(result.written).toBe(0);
    expect(await db.dmRumors.count()).toBe(0);
    expect(await db.dmSeenWraps.count()).toBe(0);
  });
});

describe("unlockWraps cancellation", () => {
  it("writes and marks nothing when stopped while the signer was working", async () => {
    // Logout stops the pipeline and THEN wipes the tables. A wave already
    // inside `decrypt` must not write into the wiped tables, and above all
    // must not leave seen marks for rows the wipe took — a seen mark with no
    // row is a message that never comes back.
    const wrap = await wrapMessage(bob, ALICE, "mid-flight");
    const stop = new AbortController();
    const real = alice.nip44.decrypt.bind(alice.nip44);
    const spy = vi
      .spyOn(alice.nip44, "decrypt")
      .mockImplementation(async (pubkey, text) => {
        stop.abort();
        return real(pubkey, text);
      });

    const outcome = await unlockWraps(
      ALICE,
      alice,
      [overTheWire(wrap)],
      stop.signal,
    );
    spy.mockRestore();

    expect(outcome.written).toBe(0);
    expect(await db.dmRumors.count()).toBe(0);
    expect(await db.dmSeenWraps.count()).toBe(0);
  });
});

describe("backfillDmHistory", () => {
  it("walks until the relays run dry, and remembers that they did", async () => {
    const wraps = await Promise.all([
      wrapMessage(bob, ALICE, "old one"),
      wrapMessage(bob, ALICE, "old two"),
    ]);
    const r = await relay({ kind: "paged", events: wraps, pageLimit: 1 });

    const progress = await backfillDmHistory(ALICE, alice, {
      relays: [r.url],
    });

    expect(progress.exhausted).toBe(true);
    expect(progress.written).toBe(2);
    expect(await isHistoryExhausted(ALICE, [r.url])).toBe(true);
  });

  it("does not walk again once it has reached the beginning", async () => {
    // Sticky per account: reaching the end is a fact about the history, and
    // re-walking it every load costs a full relay sweep to find the same
    // nothing.
    const r = await relay({ kind: "normal", events: [] });
    await backfillDmHistory(ALICE, alice, { relays: [r.url] });

    expect(await isHistoryExhausted(ALICE, [r.url])).toBe(true);
    await resetHistoryWalk(ALICE);
    expect(await isHistoryExhausted(ALICE, [r.url])).toBe(false);
  });

  it("walks again when a relay is added", async () => {
    // The bug this exists to stop: the walk is finished, so adding a relay
    // that holds mail this account has never seen does nothing at all.
    const first = await relay({ kind: "normal", events: [] });
    await backfillDmHistory(ALICE, alice, { relays: [first.url] });
    expect(await isHistoryExhausted(ALICE, [first.url])).toBe(true);

    const second = await relay({ kind: "normal", events: [] });
    expect(await isHistoryExhausted(ALICE, [first.url, second.url])).toBe(
      false,
    );
  });

  it("walks again when a relay is swapped, not just when one is added", async () => {
    // Comparing the SET, not counting it: one relay for another changes what
    // is reachable without changing how many there are.
    const first = await relay({ kind: "normal", events: [] });
    await backfillDmHistory(ALICE, alice, { relays: [first.url] });

    const other = await relay({ kind: "normal", events: [] });
    expect(await isHistoryExhausted(ALICE, [other.url])).toBe(false);
  });

  it("does not re-walk when the same relays arrive in another order", async () => {
    const a = await relay({ kind: "normal", events: [] });
    const b = await relay({ kind: "normal", events: [] });
    await backfillDmHistory(ALICE, alice, { relays: [a.url, b.url] });

    expect(await isHistoryExhausted(ALICE, [b.url, a.url])).toBe(true);
  });

  it("starts a new relay from the top, not from the old cursor", async () => {
    // The cursor records how far back the OLD relays were walked. Starting a
    // new one there skips everything it holds that is newer than that point —
    // which, for a relay just added, is most of what it has.
    const old = await relay({
      kind: "paged",
      events: [await wrapMessage(bob, ALICE, "ancient")],
    });
    await backfillDmHistory(ALICE, alice, { relays: [old.url] });

    const fresh = await relay({
      kind: "paged",
      events: [await wrapMessage(bob, ALICE, "recent, on the new relay")],
    });
    const progress = await backfillDmHistory(ALICE, alice, {
      relays: [old.url, fresh.url],
    });

    expect(progress.written).toBeGreaterThan(0);
    const contents = (await db.dmRumors.toArray()).map((r) => r.content);
    expect(contents).toContain("recent, on the new relay");
  });

  it("stops against a relay that ignores `until` and repeats itself", async () => {
    // The loop's real hazard. `until` is inclusive so a run of same-second
    // wraps is not split across the bound — which means a relay serving the
    // same page forever would otherwise never let the walk end.
    const wrap = await wrapMessage(bob, ALICE, "the only one");
    const r = await relay({ kind: "normal", events: [wrap] });

    const progress = await backfillDmHistory(ALICE, alice, {
      relays: [r.url],
      maxPages: 50,
    });

    expect(progress.exhausted).toBe(true);
    expect(progress.pages).toBeLessThan(4);
  });

  it("stops when the caller aborts", async () => {
    const wraps = await Promise.all(
      Array.from({ length: 6 }, (_, i) => wrapMessage(bob, ALICE, `m${i}`)),
    );
    const r = await relay({ kind: "paged", events: wraps, pageLimit: 1 });

    const abort = new AbortController();
    const progress = await backfillDmHistory(ALICE, alice, {
      relays: [r.url],
      signal: abort.signal,
      onProgress: () => abort.abort(),
    });

    // Aborted rather than finished, so the end is NOT recorded — the next
    // session has to pick the walk back up.
    expect(progress.exhausted).toBe(false);
    expect(await isHistoryExhausted(ALICE, [r.url])).toBe(false);
  });

  it("resumes from where the last walk stopped", async () => {
    const wraps = await Promise.all(
      Array.from({ length: 4 }, (_, i) => wrapMessage(bob, ALICE, `m${i}`)),
    );
    const r = await relay({ kind: "paged", events: wraps, pageLimit: 1 });

    await backfillDmHistory(ALICE, alice, { relays: [r.url], maxPages: 1 });
    const afterFirst = await db.dmRumors.count();

    await backfillDmHistory(ALICE, alice, { relays: [r.url] });

    // The cursor only recedes, so the second walk continued rather than
    // re-fetching the newest page it had already opened.
    expect(await db.dmRumors.count()).toBeGreaterThan(afterFirst);
    expect(await isHistoryExhausted(ALICE, [r.url])).toBe(true);
  });
});

describe("coverage the walk must not lose", () => {
  it("does not call a dead relay set the end of history", async () => {
    // The worst silent loss there was. A relay that times out, refuses, or is
    // mid-NIP-42 handshake returns nothing — indistinguishable from a relay
    // with no mail — so a cold start where every relay was still waiting on
    // the signer latched `exhausted` and the walk never ran again.
    //
    // Driven through the real read with a stubbed request rather than a dead
    // socket: applesauce retries a refused connection, so a genuinely dead
    // relay spends the full 25s read bound and a test cannot wait for it.
    const failing = vi
      .spyOn(subscription, "requestEvents")
      .mockRejectedValue(new Error("connection refused"));

    const progress = await backfillDmHistory(ALICE, alice, {
      relays: ["wss://dead.example.com/"],
      maxPages: 1,
    });

    expect(progress.exhausted).toBe(false);
    expect(await isHistoryExhausted(ALICE, ["wss://dead.example.com/"])).toBe(
      false,
    );
    failing.mockRestore();
  });

  it("does call an EMPTY relay set the end of history", async () => {
    // The other half: a relay that answers and has nothing really is the end,
    // and refusing to record that would re-walk the whole inbox every load.
    const r = await relay({ kind: "normal", events: [] });

    const progress = await backfillDmHistory(ALICE, alice, {
      relays: [r.url],
    });

    expect(progress.exhausted).toBe(true);
    expect(await isHistoryExhausted(ALICE, [r.url])).toBe(true);
  });

  it("does not let a shallow relay bound a deep one's history", async () => {
    // Relay A holds a page of recent mail; relay B holds one ancient message.
    // Taking the MIN of the two tails as the next `until` skips everything A
    // has between them — on a busy relay, most of its history.
    const recent = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        wrapMessage(bob, ALICE, `recent ${i}`),
      ),
    );
    const ancient = await wrapMessage(bob, ALICE, "ancient");
    const backdated = { ...ancient, created_at: 1000 };

    const deep = await relay({ kind: "paged", events: recent, pageLimit: 2 });
    const shallow = await relay({ kind: "paged", events: [backdated] });

    await backfillDmHistory(ALICE, alice, { relays: [deep.url, shallow.url] });

    const contents = (await db.dmRumors.toArray()).map((r) => r.content);
    // Every one of the deep relay's messages, not just its first page — and
    // the shallow relay's one ancient message alongside them.
    expect(new Set(contents)).toEqual(
      new Set(["recent 0", "recent 1", "recent 2", "ancient"]),
    );
  });

  it("resumes a walk that was interrupted before it finished", async () => {
    // The signature used to be written only on exhaustion, so every run before
    // the first COMPLETE walk saw a mismatch, cleared the cursor, and started
    // from the newest page again — an inbox needing more pages than one
    // sitting never got deeper.
    const base = Math.floor(Date.now() / 1000) - 600;
    const wraps = await Promise.all(
      Array.from({ length: 6 }, (_, i) => wrapMessage(bob, ALICE, `m${i}`)),
    ).then((all) =>
      // Distinct timestamps, or `until` has nowhere to walk to.
      all.map((wrap, i) => ({ ...wrap, created_at: base + i })),
    );
    const r = await relay({ kind: "paged", events: wraps, pageLimit: 1 });

    await backfillDmHistory(ALICE, alice, { relays: [r.url], maxPages: 4 });
    const afterFirst = await db.dmRumors.count();
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterFirst).toBeLessThan(wraps.length);
    expect(await isHistoryExhausted(ALICE, [r.url])).toBe(false);

    // A second, equally short run continues rather than re-walking the top.
    await backfillDmHistory(ALICE, alice, { relays: [r.url], maxPages: 4 });
    expect(await db.dmRumors.count()).toBeGreaterThan(afterFirst);
  });

  it("keeps decrypted messages when the walk is cut short", async () => {
    // Marking a batch seen and writing it once at the end meant an abort in
    // between left wraps recorded as opened with no row to show for it — and
    // `seenWrapIds` never hands those back. Decrypted messages, gone for good.
    const wraps = await Promise.all(
      Array.from({ length: DECRYPT_WAVE * 2 }, (_, i) =>
        wrapMessage(bob, ALICE, `m${i}`),
      ),
    ).then((w) => w.map(overTheWire));

    await unlockWraps(ALICE, alice, wraps);

    // Every wrap marked seen has a row behind it.
    const seen = await db.dmSeenWraps.where({ viewer: ALICE }).toArray();
    const opened = seen.filter((row) => row.opened);
    expect(opened).toHaveLength(wraps.length);
    expect(await db.dmRumors.count()).toBe(wraps.length);
  });

  it("tries unopened wraps again when the reader asks for a rescan", async () => {
    // The attempt cap cannot tell a malformed wrap from a signer that was
    // refusing, and a sync runs on mount AND on every conversation open — so
    // three attempts can burn in under a minute. Rescan is the escape hatch.
    const wraps = await Promise.all([
      wrapMessage(bob, ALICE, "one"),
      wrapMessage(bob, ALICE, "two"),
    ]).then((w) => w.map(overTheWire));

    const broken = vi
      .spyOn(alice.nip44, "decrypt")
      .mockRejectedValue(new Error("signer refused"));
    for (let attempt = 0; attempt < DM_WRAP_MAX_ATTEMPTS; attempt += 1)
      await unlockWraps(ALICE, alice, wraps);
    broken.mockRestore();

    // Written off by the cap.
    expect(await unlockWraps(ALICE, alice, wraps)).toMatchObject({
      written: 0,
    });

    await resetHistoryWalk(ALICE);
    expect(await unlockWraps(ALICE, alice, wraps)).toMatchObject({
      written: 2,
    });
  });
});
