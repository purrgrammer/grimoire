/**
 * The unread scan, and the two bounds that keep the badge honest.
 *
 * `latest` is the load-bearing return value: it is what lets the adapter stamp
 * past rows the fold hid, and it is only correct because the cursor walks
 * DESCENDING. The ">cap" case here is the foundation of the stuck-badge
 * regression test in the adapter — an ascending scan passes every other test in
 * this file and fails that one.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  KIND_CALENDAR_DATE,
  KIND_COMMENT,
  KIND_DELETE,
  KIND_MESSAGE,
  KIND_POLL,
  KIND_POLL_VOTE,
  KIND_REACTION,
} from "@/lib/concord/kinds";
import { channelUnreadSummary, writeChatRumors } from "./concord-rumor-store";
import db from "./db";

const COMMUNITY = "aa".repeat(32);
const CHANNEL = "bb".repeat(32);
const ME = "11".repeat(32);
const THEM = "22".repeat(32);

const NOW = 1_800_000_000;
const SKEW = 3600;

let seq = 0;
function rumorId(): string {
  seq += 1;
  return seq.toString(16).padStart(64, "0");
}

async function seed(
  rows: Array<{
    at: number;
    kind?: number;
    author?: string;
    tags?: string[][];
  }>,
): Promise<void> {
  await writeChatRumors(
    COMMUNITY,
    rows.map((r) => ({
      rumorId: rumorId(),
      author: r.author ?? THEM,
      kind: r.kind ?? KIND_MESSAGE,
      content: "hi",
      tags: r.tags ?? [],
      createdAt: r.at,
      ms: r.at * 1000,
      channel: CHANNEL,
    })),
    // The write refuses an already-expired rumor, so seed against a clock
    // BEFORE the deadlines the tests then read past.
    0,
  );
}

const summary = (after: number, selfPubkey = ME) =>
  channelUnreadSummary(COMMUNITY, CHANNEL, {
    after,
    nowSecs: NOW,
    maxFutureSecs: SKEW,
    selfPubkey,
  });

beforeEach(async () => {
  await db.concordRumors.clear();
  seq = 0;
});

describe("channelUnreadSummary", () => {
  it("counts nothing in an empty channel", async () => {
    expect(await summary(0)).toEqual({
      count: 0,
      latest: 0,
      mention: false,
      capped: false,
    });
  });

  it("counts every timeline kind, and no side kind", async () => {
    await seed([
      { at: NOW - 500, kind: KIND_MESSAGE },
      { at: NOW - 400, kind: KIND_COMMENT },
      { at: NOW - 300, kind: KIND_POLL },
      { at: NOW - 200, kind: KIND_CALENDAR_DATE },
      { at: NOW - 100, kind: KIND_REACTION },
      { at: NOW - 90, kind: KIND_DELETE },
      { at: NOW - 80, kind: KIND_POLL_VOTE },
    ]);
    const out = await summary(NOW - 1000);
    expect(out.count).toBe(4);
    // The newest COUNTED row, not the newest row: the reaction above it is not
    // a timeline row and cannot be what the reader is behind on.
    expect(out.latest).toBe(NOW - 200);
  });

  it("does not count the reader's own messages", async () => {
    await seed([
      { at: NOW - 300, author: ME },
      { at: NOW - 200, author: THEM },
    ]);
    const out = await summary(NOW - 1000);
    expect(out.count).toBe(1);
    expect(out.latest).toBe(NOW - 200);
  });

  it("treats a message dated exactly at the stamp as read", async () => {
    // The boundary is the whole contract of the lower bound: mark-read stamps
    // the newest message's own timestamp, so an inclusive bound would leave the
    // channel one message unread forever.
    await seed([{ at: 1000 }, { at: 1001 }]);
    const out = await summary(1000);
    expect(out.count).toBe(1);
    expect(out.latest).toBe(1001);
  });

  it("ignores a row dated past the future-skew window", async () => {
    await seed([
      { at: NOW - 100 },
      { at: NOW + SKEW }, // exactly at the bound: still counted
      { at: NOW + SKEW + 1 }, // beyond it: invisible until the clock arrives
    ]);
    const out = await summary(NOW - 1000);
    expect(out.count).toBe(2);
    expect(out.latest).toBe(NOW + SKEW);
  });

  it("ignores a rumor whose NIP-40 deadline has passed", async () => {
    await seed([
      { at: NOW - 300, tags: [["expiration", String(NOW - 10)]] },
      { at: NOW - 200 },
    ]);
    const out = await summary(NOW - 1000);
    expect(out.count).toBe(1);
    expect(out.latest).toBe(NOW - 200);
  });

  it("flags a mention from a p tag naming the reader", async () => {
    await seed([{ at: NOW - 300 }]);
    expect((await summary(NOW - 1000)).mention).toBe(false);
    await seed([{ at: NOW - 200, tags: [["p", ME]] }]);
    expect((await summary(NOW - 1000)).mention).toBe(true);
  });

  it("does not flag a mention of somebody else", async () => {
    await seed([{ at: NOW - 200, tags: [["p", THEM]] }]);
    expect((await summary(NOW - 1000)).mention).toBe(false);
  });

  it("stops at the cap and says so", async () => {
    await seed(Array.from({ length: 12 }, (_, i) => ({ at: NOW - 1000 + i })));
    const out = await channelUnreadSummary(COMMUNITY, CHANNEL, {
      after: 0,
      nowSecs: NOW,
      maxFutureSecs: SKEW,
      selfPubkey: ME,
      cap: 10,
    });
    expect(out.count).toBe(10);
    expect(out.capped).toBe(true);
  });

  it("reports the NEWEST qualifying row as `latest` even when capped", async () => {
    // The descending-scan guarantee. Ascending, `latest` would be the newest of
    // the OLDEST ten rows — the stamp could never reach past the cap, and a
    // channel with more than a hundred unread would badge forever.
    await seed(Array.from({ length: 60 }, (_, i) => ({ at: NOW - 1000 + i })));
    const out = await channelUnreadSummary(COMMUNITY, CHANNEL, {
      after: 0,
      nowSecs: NOW,
      maxFutureSecs: SKEW,
      selfPubkey: ME,
      cap: 10,
    });
    expect(out.capped).toBe(true);
    expect(out.latest).toBe(NOW - 1000 + 59);
  });

  it("stays inside the channel and the community it was asked about", async () => {
    await seed([{ at: NOW - 100 }]);
    await writeChatRumors(
      COMMUNITY,
      [
        {
          rumorId: rumorId(),
          author: THEM,
          kind: KIND_MESSAGE,
          content: "elsewhere",
          tags: [],
          createdAt: NOW - 50,
          ms: (NOW - 50) * 1000,
          channel: "cc".repeat(32),
        },
      ],
      0,
    );
    const out = await summary(0);
    expect(out.count).toBe(1);
    expect(out.latest).toBe(NOW - 100);
  });
});

describe("a banned author's messages", () => {
  const BANNED = "33".repeat(32);

  const withBan = (after: number) =>
    channelUnreadSummary(COMMUNITY, CHANNEL, {
      after,
      nowSecs: NOW,
      maxFutureSecs: SKEW,
      selfPubkey: ME,
      bannedAuthors: new Set([BANNED]),
    });

  it("are not counted, because the timeline does not show them", async () => {
    await seed([{ at: NOW - 300, author: BANNED }, { at: NOW - 200 }]);
    expect((await withBan(0)).count).toBe(1);
  });

  it("do not raise the @ flag either, even addressed to the reader", async () => {
    await seed([{ at: NOW - 300, author: BANNED, tags: [["p", ME]] }]);
    expect((await withBan(0)).mention).toBe(false);
  });

  it("still raise `latest`, so the stamp can pass them", async () => {
    // The asymmetry that keeps the badge clearable: `markRead` scans without a
    // banlist, so a banned row it could not stamp past would be re-counted by
    // any caller that also had no banlist — forever.
    await seed([{ at: NOW - 200 }, { at: NOW - 100, author: BANNED }]);
    const out = await withBan(0);
    expect(out.count).toBe(1);
    expect(out.latest).toBe(NOW - 100);
  });

  it("count again once the ban is lifted", async () => {
    await seed([{ at: NOW - 300, author: BANNED }]);
    expect((await withBan(0)).count).toBe(0);
    expect((await summary(0)).count).toBe(1);
  });
});
