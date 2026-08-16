/**
 * The stamp store: monotonic, account-scoped, and wiped on logout.
 *
 * Every one of these guards a way the badge could lie rather than a way it
 * could look wrong: a stamp that moves backwards resurrects a cleared badge,
 * and a stamp that is not account-scoped shows one person another's channels.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { KIND_MESSAGE } from "@/lib/concord/kinds";
import {
  clearReads,
  communityUnread,
  markChannelRead,
  readCommunityLastReads,
  readLastRead,
} from "./concord-reads";
import { writeChatRumors } from "./concord-rumor-store";
import db from "./db";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);
const COMMUNITY = "aa".repeat(32);
const CHANNEL = "bb".repeat(32);
const OTHER_CHANNEL = "cc".repeat(32);

beforeEach(async () => {
  await db.chatReads.clear();
  await db.concordRumors.clear();
});

describe("markChannelRead", () => {
  it("stamps a channel that has never been read", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(500);
  });

  it("moves the stamp forward", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    await markChannelRead(ME, COMMUNITY, CHANNEL, 900);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(900);
  });

  it("never moves the stamp backwards", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 900);
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(900);
  });

  it("ignores a zero or negative stamp", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 900);
    await markChannelRead(ME, COMMUNITY, CHANNEL, 0);
    await markChannelRead(ME, COMMUNITY, CHANNEL, -5);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(900);
    // …and does not create a row where there was none.
    await markChannelRead(ME, COMMUNITY, OTHER_CHANNEL, 0);
    expect(
      await db.chatReads.get([ME, "concord", COMMUNITY, OTHER_CHANNEL]),
    ).toBe(undefined);
  });

  it("keeps two accounts' stamps for the same channel apart", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 900);
    await markChannelRead(THEM, COMMUNITY, CHANNEL, 100);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(900);
    expect(await readLastRead(THEM, COMMUNITY, CHANNEL)).toBe(100);
  });

  it("lowercases both ids, so a mixed-case caller hits the same row", async () => {
    await markChannelRead(ME, COMMUNITY.toUpperCase(), CHANNEL, 700);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL.toUpperCase())).toBe(700);
    expect(await db.chatReads.count()).toBe(1);
  });
});

describe("readLastRead", () => {
  it("reports 0 for a channel never opened", async () => {
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(0);
  });
});

describe("readCommunityLastReads", () => {
  it("returns every channel this account stamped in one community", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    await markChannelRead(ME, COMMUNITY, OTHER_CHANNEL, 800);
    await markChannelRead(ME, "dd".repeat(32), CHANNEL, 999);
    await markChannelRead(THEM, COMMUNITY, CHANNEL, 111);

    const map = await readCommunityLastReads(ME, COMMUNITY);
    expect(map.get(CHANNEL)).toBe(500);
    expect(map.get(OTHER_CHANNEL)).toBe(800);
    expect(map.size).toBe(2);
  });

  it("ignores another protocol's cursor for the same ids", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    // The row a NIP-29 writer would put down. Same reader, same id strings,
    // different protocol — the discriminator is the only thing keeping the two
    // apart, and a range read that dropped it would report this one as
    // Concord's.
    await db.chatReads.put({
      pubkey: ME,
      protocol: "nip-29",
      containerId: COMMUNITY,
      channelId: OTHER_CHANNEL,
      lastRead: 4242,
      updatedAt: Date.now(),
    });

    const map = await readCommunityLastReads(ME, COMMUNITY);
    expect(map.get(CHANNEL)).toBe(500);
    expect(map.size).toBe(1);
    expect(await readLastRead(ME, COMMUNITY, OTHER_CHANNEL)).toBe(0);
  });
});

describe("clearReads", () => {
  it("takes only the account that logged out", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    await markChannelRead(THEM, COMMUNITY, CHANNEL, 500);
    await clearReads(ME);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(0);
    expect(await readLastRead(THEM, COMMUNITY, CHANNEL)).toBe(500);
  });

  it("takes that account's cursors in every protocol, not just Concord", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    await db.chatReads.put({
      pubkey: ME,
      protocol: "nip-29",
      containerId: "wss://groups.example/",
      channelId: "general",
      lastRead: 900,
      updatedAt: Date.now(),
    });
    await clearReads(ME);
    expect(await db.chatReads.where("pubkey").equals(ME).count()).toBe(0);
  });
});

describe("communityUnread", () => {
  const NOW = 1_800_000_000;
  let seq = 0;

  async function post(
    communityId: string,
    channelId: string,
    at: number,
    tags: string[][] = [],
  ): Promise<void> {
    seq += 1;
    await writeChatRumors(
      communityId,
      [
        {
          rumorId: (seq + 0x2000).toString(16).padStart(64, "0"),
          author: THEM,
          kind: KIND_MESSAGE,
          content: "hi",
          tags,
          createdAt: at,
          ms: at * 1000,
          channel: channelId,
        },
      ],
      0,
    );
  }

  it("adds up the channels it was given, and stops at the ones it was not", async () => {
    await post(COMMUNITY, CHANNEL, NOW - 300);
    await post(COMMUNITY, CHANNEL, NOW - 200);
    await post(COMMUNITY, OTHER_CHANNEL, NOW - 100);

    expect(
      await communityUnread(ME, COMMUNITY, [CHANNEL, OTHER_CHANNEL], NOW),
    ).toEqual({ count: 3, mention: false });
    expect(await communityUnread(ME, COMMUNITY, [CHANNEL], NOW)).toEqual({
      count: 2,
      mention: false,
    });
  });

  it("honours each channel's own stamp", async () => {
    await post(COMMUNITY, CHANNEL, NOW - 300);
    await post(COMMUNITY, OTHER_CHANNEL, NOW - 100);
    await markChannelRead(ME, COMMUNITY, CHANNEL, NOW - 300);

    expect(
      await communityUnread(ME, COMMUNITY, [CHANNEL, OTHER_CHANNEL], NOW),
    ).toEqual({ count: 1, mention: false });
  });

  it("raises the mention flag from any one of its channels", async () => {
    await post(COMMUNITY, CHANNEL, NOW - 300);
    await post(COMMUNITY, OTHER_CHANNEL, NOW - 100, [["p", ME]]);
    const total = await communityUnread(
      ME,
      COMMUNITY,
      [CHANNEL, OTHER_CHANNEL],
      NOW,
    );
    expect(total.mention).toBe(true);
  });

  it("keeps two communities' totals apart", async () => {
    const other = "dd".repeat(32);
    await post(COMMUNITY, CHANNEL, NOW - 300);
    await post(other, CHANNEL, NOW - 200);
    await post(other, CHANNEL, NOW - 100);

    expect((await communityUnread(ME, COMMUNITY, [CHANNEL], NOW)).count).toBe(
      1,
    );
    expect((await communityUnread(ME, other, [CHANNEL], NOW)).count).toBe(2);
  });
});
