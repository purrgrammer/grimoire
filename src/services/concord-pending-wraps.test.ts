/**
 * The parked-wrap store: the one place a wrap is persisted.
 *
 * Every test here guards a property whose absence is silent — a wrap that
 * vanishes, or a drain that never looks.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "nostr-tools";

import db from "@/services/db";

import {
  _resetPendingWrapsForTests,
  ackPendingWraps,
  parkPendingWraps,
  peekPendingWraps,
} from "./concord-rumor-store";

const STREAM_A = "aa".repeat(32);
const STREAM_B = "bb".repeat(32);

let counter = 0;

/** Now, in seconds. Fixtures must be RECENT — a wrap older than 14 days is
 *  pruned on the first peek, which is the store working as designed. */
const NOW = Math.floor(Date.now() / 1000);

function wrap(over: Partial<NostrEvent> = {}): NostrEvent {
  counter++;
  return {
    id: counter.toString(16).padStart(64, "0"),
    pubkey: STREAM_A,
    kind: 1059,
    created_at: NOW - 60,
    content: "ciphertext",
    tags: [["p", "cc".repeat(32)]],
    sig: "ff".repeat(64),
    ...over,
  } as NostrEvent;
}

beforeEach(async () => {
  await db.concordPendingWraps.clear();
  _resetPendingWrapsForTests();
});

describe("parkPendingWraps", () => {
  it("keeps the ciphertext but drops the signature", async () => {
    await parkPendingWraps([wrap()]);

    const rows = await db.concordPendingWraps.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("ciphertext");
    // A wrap is signed by a throwaway ephemeral key that nothing ever checks —
    // authorship is the seal sealed inside it (CORD-01) — so storing the
    // signature would preserve a proof of nothing.
    expect("sig" in rows[0]).toBe(false);
  });

  it("is idempotent for the same wrap arriving twice", async () => {
    const w = wrap();
    await parkPendingWraps([w]);
    await parkPendingWraps([w]);
    expect(await db.concordPendingWraps.count()).toBe(1);
  });
});

describe("peekPendingWraps", () => {
  it("returns only the wraps for the addresses asked about", async () => {
    await parkPendingWraps([wrap(), wrap({ pubkey: STREAM_B })]);

    const mine = await peekPendingWraps([STREAM_A]);
    expect(mine.map((w) => w.pubkey)).toEqual([STREAM_A]);
  });

  it("finds a wrap parked in a PREVIOUS session", async () => {
    // The whole reason `pendingKnownEmpty` is a tri-state rather than a boolean.
    // The row is durable and nothing re-parks it, so a session that starts with
    // "nothing was parked THIS session" would hide it from the drain forever.
    await db.concordPendingWraps.put({
      id: "de".repeat(32),
      pubkey: STREAM_A,
      kind: 1059,
      created_at: NOW - 60,
      content: "from last time",
      tags: [],
    });
    _resetPendingWrapsForTests(); // a fresh session: knows nothing

    const found = await peekPendingWraps([STREAM_A]);
    expect(found.map((w) => w.content)).toEqual(["from last time"]);
  });

  it("does NOT remove what it returns", async () => {
    await parkPendingWraps([wrap()]);

    await peekPendingWraps([STREAM_A]);
    // Removing at peek time loses a wrap whose store write then fails. The
    // caller acks; peek only reads.
    expect(await db.concordPendingWraps.count()).toBe(1);
    expect(await peekPendingWraps([STREAM_A])).toHaveLength(1);
  });

  it("stops touching IndexedDB once known empty", async () => {
    const spy = vi.spyOn(db.concordPendingWraps, "where");
    // First peek probes (the store really is empty), and every later one is a
    // memory read — this drain sits on the channel-read hot path.
    expect(await peekPendingWraps([STREAM_A])).toEqual([]);
    expect(await peekPendingWraps([STREAM_A])).toEqual([]);
    expect(await peekPendingWraps([STREAM_A])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not let an empty probe clobber a concurrent park", async () => {
    // Armada calls this race out explicitly: the probe starts against an empty
    // store, a wrap is parked while it is in flight, and a probe result of
    // "empty" would then latch `true` and hide the new row from every later
    // peek this session.
    const probe = peekPendingWraps([STREAM_A]);
    const parked = parkPendingWraps([wrap()]);
    await probe;
    await parked;

    expect(await peekPendingWraps([STREAM_A])).toHaveLength(1);
  });

  it("returns nothing when asked about no addresses", async () => {
    await parkPendingWraps([wrap()]);
    expect(await peekPendingWraps([])).toEqual([]);
  });

  it("prunes wraps whose key never arrived", async () => {
    await parkPendingWraps([
      wrap({ created_at: NOW - 15 * 24 * 3600 }),
      wrap({ created_at: NOW - 1 }),
    ]);

    await peekPendingWraps([STREAM_A]);
    // The prune's delete is fire-and-forget inside peek.
    await new Promise<void>((r) => setTimeout(r, 0));

    // A wrap whose key never arrives is a dead plane, not a queue.
    const left = await db.concordPendingWraps.toArray();
    expect(left).toHaveLength(1);
    expect(left[0].created_at).toBe(NOW - 1);
  });
});

describe("ackPendingWraps", () => {
  it("drops only the ids it is given", async () => {
    const keep = wrap();
    const done = wrap();
    await parkPendingWraps([keep, done]);

    await ackPendingWraps([done.id]);

    expect((await db.concordPendingWraps.toArray()).map((w) => w.id)).toEqual([
      keep.id,
    ]);
  });

  it("leaves a wrap parked when nothing acked it", async () => {
    // The loss-proof half: a decode round that opened nothing, or a store write
    // that failed, acks nothing — and the wrap is still there next time.
    await parkPendingWraps([wrap()]);
    await ackPendingWraps([]);
    expect(await db.concordPendingWraps.count()).toBe(1);
  });
});
