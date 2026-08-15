/**
 * CORD-08 §3's third duty: physically purge expired rumors.
 *
 * The other two — refuse at ingest, refuse to display — are pinned elsewhere.
 * This one is the reason they are not enough on their own: a hidden rumor is
 * still plaintext in IndexedDB, and the local store is exactly the artifact a
 * seized device surrenders.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  KIND_CONTROL,
  KIND_DELETE,
  KIND_JOIN_LEAVE,
  KIND_KICK,
  KIND_MESSAGE,
  KIND_REKEY,
  KIND_SNAPSHOT,
} from "@/lib/concord/kinds";
import {
  _resetExpirySweepForTests,
  sweepExpiredRumors,
} from "@/services/concord-expiry";
import db from "@/services/db";

const communityId = "aa".repeat(32);
const channel = "bb".repeat(32);
const NOW = Math.floor(Date.now() / 1000);

let nextId = 0;
function put(kind: number, expiration?: number) {
  const id = (nextId++).toString(16).padStart(64, "0");
  return db.concordRumors
    .put({
      id,
      communityId,
      kind,
      channel,
      created_at: NOW - 100,
      pubkey: "cc".repeat(32),
      content: "x",
      tags:
        expiration !== undefined ? [["expiration", String(expiration)]] : [],
    })
    .then(() => id);
}

beforeEach(async () => {
  await db.concordRumors.clear();
  _resetExpirySweepForTests();
});

afterEach(async () => {
  await db.concordRumors.clear();
});

describe("sweepExpiredRumors", () => {
  it("deletes what has expired and keeps what has not", async () => {
    const gone = await put(KIND_MESSAGE, NOW - 10);
    const alive = await put(KIND_MESSAGE, NOW + 3600);
    const timeless = await put(KIND_MESSAGE);

    expect(await sweepExpiredRumors()).toBe(1);
    expect(await db.concordRumors.get(gone)).toBeUndefined();
    expect(await db.concordRumors.get(alive)).toBeDefined();
    expect(await db.concordRumors.get(timeless)).toBeDefined();
  });

  it("treats a malformed deadline as absent, never as expired", async () => {
    // A garbage tag must not be able to delete a message. Same lenient parse
    // the ingest and the display use.
    const id = await db.concordRumors
      .put({
        id: "ff".repeat(32),
        communityId,
        kind: KIND_MESSAGE,
        channel,
        created_at: NOW - 100,
        pubkey: "cc".repeat(32),
        content: "x",
        tags: [["expiration", "soon"]],
      })
      .then(() => "ff".repeat(32));
    await sweepExpiredRumors();
    expect(await db.concordRumors.get(id)).toBeDefined();
  });

  it("purges by the deadline alone — an exempt KIND that carries one still goes", async () => {
    // Deletes never carry an expiration (CORD-08 §2), so one that somehow does
    // was not minted by a compliant sender. The predicate stays the tag, which
    // is what keeps this identical to the ingest and display checks.
    const id = await put(KIND_DELETE, NOW - 10);
    await sweepExpiredRumors();
    expect(await db.concordRumors.get(id)).toBeUndefined();
  });

  it("NEVER touches a plane rumor, whatever tag it carries", async () => {
    // CORD-08 is a Chat-plane feature, and deleting a plane rumor is not
    // recoverable: the Guestbook rides a PERSISTED forward cursor and never
    // re-fetches behind it. The concrete attack — a member publishes their own
    // Leave carrying a past `expiration`, this deletes it, the cursor never
    // serves it again, and the coalesce falls back to their older Join. A
    // permanent local presence spoof.
    const leave = await put(KIND_JOIN_LEAVE, NOW - 10);
    const kick = await put(KIND_KICK, NOW - 10);
    const snapshot = await put(KIND_SNAPSHOT, NOW - 10);
    const edition = await put(KIND_CONTROL, NOW - 10);
    const rekey = await put(KIND_REKEY, NOW - 10);
    const message = await put(KIND_MESSAGE, NOW - 10);

    expect(await sweepExpiredRumors()).toBe(1);
    for (const id of [leave, kick, snapshot, edition, rekey]) {
      expect(await db.concordRumors.get(id)).toBeDefined();
    }
    expect(await db.concordRumors.get(message)).toBeUndefined();
  });

  it("crosses community boundaries — every tenant's expiry is the same duty", async () => {
    await put(KIND_MESSAGE, NOW - 10);
    await db.concordRumors.put({
      id: "ee".repeat(32),
      communityId: "dd".repeat(32),
      kind: KIND_MESSAGE,
      channel,
      created_at: NOW - 100,
      pubkey: "cc".repeat(32),
      content: "x",
      tags: [["expiration", String(NOW - 10)]],
    });
    expect(await sweepExpiredRumors()).toBe(2);
  });

  it("is rate-limited, so several windows mounting at once scan once", async () => {
    await put(KIND_MESSAGE, NOW - 10);
    expect(await sweepExpiredRumors()).toBe(1);

    const late = await put(KIND_MESSAGE, NOW - 5);
    // Inside the interval: nothing runs, so the second row survives…
    expect(await sweepExpiredRumors()).toBe(0);
    expect(await db.concordRumors.get(late)).toBeDefined();
    // …until the next window, or an explicit force.
    expect(await sweepExpiredRumors({ force: true })).toBe(1);
  });

  it("a FORCED sweep waits for the one in flight rather than inheriting it", async () => {
    // Inheriting is wrong for a forced caller: the in-flight result was
    // computed before whatever they want swept existed.
    await put(KIND_MESSAGE, NOW - 10);
    const running = sweepExpiredRumors();
    const late = await put(KIND_MESSAGE, NOW - 5);
    const forced = sweepExpiredRumors({ force: true });
    expect(await running).toBe(1);
    expect(await forced).toBe(1);
    expect(await db.concordRumors.get(late)).toBeUndefined();
  });

  it("single-flights concurrent sweeps", async () => {
    await put(KIND_MESSAGE, NOW - 10);
    const [a, b] = await Promise.all([
      sweepExpiredRumors(),
      sweepExpiredRumors(),
    ]);
    // The joiner sees the same result rather than double-counting the deletes.
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
