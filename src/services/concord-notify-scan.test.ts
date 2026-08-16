/**
 * The notifier's read of a channel — the same range as the unread scan, with
 * one difference that matters: a banned author's rows are GONE, not merely
 * uncounted. The badge lets them raise a stamp so it can be cleared; an alert
 * that pulls someone to a channel to find a message the timeline hides has no
 * such excuse.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { KIND_MESSAGE, KIND_COMMENT, KIND_REACTION } from "@/lib/concord/kinds";
import { channelRumorsSince, writeChatRumors } from "./concord-rumor-store";
import db from "./db";

const COMMUNITY = "aa".repeat(32);
const CHANNEL = "bb".repeat(32);
const ME = "11".repeat(32);
const THEM = "22".repeat(32);
const BANNED = "33".repeat(32);

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
    0,
  );
}

const since = (
  after: number,
  opts: { banned?: ReadonlySet<string>; cap?: number } = {},
) =>
  channelRumorsSince(COMMUNITY, CHANNEL, {
    after,
    nowSecs: NOW,
    maxFutureSecs: SKEW,
    selfPubkey: ME,
    ...(opts.banned ? { bannedAuthors: opts.banned } : {}),
    ...(opts.cap !== undefined ? { cap: opts.cap } : {}),
  });

beforeEach(async () => {
  await db.concordRumors.clear();
  seq = 0;
});

describe("channelRumorsSince", () => {
  it("finds nothing in an empty channel", async () => {
    expect(await since(0)).toEqual([]);
  });

  it("returns the fresh rows, newest first", async () => {
    await seed([{ at: NOW - 30 }, { at: NOW - 10 }, { at: NOW - 20 }]);
    const rows = await since(NOW - 60);
    expect(rows.map((r) => r.created_at)).toEqual([
      NOW - 10,
      NOW - 20,
      NOW - 30,
    ]);
  });

  it("treats a row dated exactly at the bound as already seen", async () => {
    await seed([{ at: NOW - 20 }, { at: NOW - 10 }]);
    const rows = await since(NOW - 20);
    expect(rows.map((r) => r.created_at)).toEqual([NOW - 10]);
  });

  it("skips the reader's own messages", async () => {
    await seed([{ at: NOW - 10, author: ME }, { at: NOW - 20 }]);
    const rows = await since(0);
    expect(rows.map((r) => r.pubkey)).toEqual([THEM]);
  });

  it("drops a banned author's rows entirely", async () => {
    await seed([{ at: NOW - 10, author: BANNED }, { at: NOW - 20 }]);
    const rows = await since(0, { banned: new Set([BANNED]) });
    expect(rows.map((r) => r.pubkey)).toEqual([THEM]);
  });

  it("takes replies as well as messages, but not reactions", async () => {
    await seed([
      { at: NOW - 10, kind: KIND_COMMENT },
      { at: NOW - 20, kind: KIND_REACTION },
      { at: NOW - 30, kind: KIND_MESSAGE },
    ]);
    const rows = await since(0);
    expect(rows.map((r) => r.kind)).toEqual([KIND_COMMENT, KIND_MESSAGE]);
  });

  it("skips a rumor past its NIP-40 deadline", async () => {
    await seed([
      { at: NOW - 10, tags: [["expiration", String(NOW - 5)]] },
      { at: NOW - 20 },
    ]);
    const rows = await since(0);
    expect(rows.map((r) => r.created_at)).toEqual([NOW - 20]);
  });

  it("ignores a row dated implausibly far in the future", async () => {
    // `created_at` is attacker-chosen and ingest has no clock check, so a
    // year-3000 message would otherwise alert forever.
    await seed([{ at: NOW + SKEW + 10 }, { at: NOW - 10 }]);
    const rows = await since(0);
    expect(rows.map((r) => r.created_at)).toEqual([NOW - 10]);
  });

  it("stops at the cap, keeping the newest rows", async () => {
    await seed([
      { at: NOW - 40 },
      { at: NOW - 30 },
      { at: NOW - 20 },
      { at: NOW - 10 },
    ]);
    const rows = await since(0, { cap: 2 });
    expect(rows.map((r) => r.created_at)).toEqual([NOW - 10, NOW - 20]);
  });

  it("belongs to one channel of one community", async () => {
    await seed([{ at: NOW - 10 }]);
    expect(
      await channelRumorsSince(COMMUNITY, "cc".repeat(32), {
        after: 0,
        nowSecs: NOW,
        maxFutureSecs: SKEW,
      }),
    ).toEqual([]);
    expect(
      await channelRumorsSince("dd".repeat(32), CHANNEL, {
        after: 0,
        nowSecs: NOW,
        maxFutureSecs: SKEW,
      }),
    ).toEqual([]);
  });
});
