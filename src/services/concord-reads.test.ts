/**
 * The stamp store: monotonic, account-scoped, and wiped on logout.
 *
 * Every one of these guards a way the badge could lie rather than a way it
 * could look wrong: a stamp that moves backwards resurrects a cleared badge,
 * and a stamp that is not account-scoped shows one person another's channels.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearReads,
  markChannelRead,
  readCommunityLastReads,
  readLastRead,
} from "./concord-reads";
import db from "./db";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);
const COMMUNITY = "aa".repeat(32);
const CHANNEL = "bb".repeat(32);
const OTHER_CHANNEL = "cc".repeat(32);

beforeEach(async () => {
  await db.concordReads.clear();
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
    expect(await db.concordReads.get([ME, COMMUNITY, OTHER_CHANNEL])).toBe(
      undefined,
    );
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
    expect(await db.concordReads.count()).toBe(1);
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
});

describe("clearReads", () => {
  it("takes only the account that logged out", async () => {
    await markChannelRead(ME, COMMUNITY, CHANNEL, 500);
    await markChannelRead(THEM, COMMUNITY, CHANNEL, 500);
    await clearReads(ME);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(0);
    expect(await readLastRead(THEM, COMMUNITY, CHANNEL)).toBe(500);
  });
});
