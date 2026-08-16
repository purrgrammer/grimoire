/**
 * The schema upgrades that carry a populated database forward.
 *
 * These run against a THROWAWAY database name, not the app's: a Dexie upgrade
 * only ever executes once per browser profile, so the only way to see one work
 * is to build the old schema by hand, put rows in it, and open the real class
 * on top. The failure this guards is the quiet one — an upgrade that creates
 * the new store and forgets to carry the old rows into it, which no type and no
 * other test can see, and which the reader experiences as read channels
 * relighting and a muted channel ringing again.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Dexie } from "dexie";

import { GrimoireDb } from "./db";
import { channelLevelKey, containerLevelKey } from "./concord-notif-prefs";

const ME = "11".repeat(32);
const COMMUNITY = "aa".repeat(32);
const CHANNEL = "bb".repeat(32);

const names: string[] = [];

/** A database name no other test shares, torn down afterwards. */
function scratchName(): string {
  const name = `grimoire-migration-${names.length}-${Date.now()}`;
  names.push(name);
  return name;
}

afterEach(async () => {
  while (names.length > 0) await Dexie.delete(names.pop()!);
});

/**
 * The v24 shape, as a user upgrading from the released build has it.
 *
 * Only the tables these upgrades touch: Dexie carries the rest forward on its
 * own, and a partial old schema is exactly what a real old database is
 * relative to the current one.
 */
async function seedV24(name: string): Promise<void> {
  const old = new Dexie(name);
  old.version(24).stores({
    concordReads:
      "&[pubkey+communityId+channelId], pubkey, [pubkey+communityId]",
    concordKv: "&key",
  });
  await old.open();
  await old.table("concordReads").put({
    pubkey: ME,
    communityId: COMMUNITY,
    channelId: CHANNEL,
    lastRead: 1_700_000_000,
    updatedAt: 1_700_000_000_000,
  });
  await old.table("concordKv").bulkPut([
    { key: `c2notif:${COMMUNITY}`, value: "mentions" },
    { key: `c2notif:${COMMUNITY}::${CHANNEL}`, value: "nothing" },
  ]);
  old.close();
}

describe("version 25: the read cursor becomes protocol-qualified", () => {
  it("carries every stamp forward under protocol concord", async () => {
    const name = scratchName();
    await seedV24(name);

    const db = new GrimoireDb(name);
    await db.open();
    try {
      const row = await db.chatReads.get([ME, "concord", COMMUNITY, CHANNEL]);
      expect(row?.lastRead).toBe(1_700_000_000);
      expect(row?.updatedAt).toBe(1_700_000_000_000);
      // …and the stamp is still reachable the way the sidebar asks for it.
      const range = await db.chatReads
        .where("[pubkey+protocol+containerId]")
        .equals([ME, "concord", COMMUNITY])
        .toArray();
      expect(range).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("drops the superseded table once its rows are copied", async () => {
    const name = scratchName();
    await seedV24(name);

    const db = new GrimoireDb(name);
    await db.open();
    try {
      expect(db.tables.map((t) => t.name)).not.toContain("concordReads");
    } finally {
      db.close();
    }
  });

  it("opens a database that never held the old tables", async () => {
    const name = scratchName();
    const db = new GrimoireDb(name);
    await db.open();
    try {
      await db.chatReads.put({
        pubkey: ME,
        protocol: "concord",
        containerId: COMMUNITY,
        channelId: CHANNEL,
        lastRead: 7,
        updatedAt: 8,
      });
      expect(await db.chatReads.count()).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("the ladder replays from every version that ever shipped", () => {
  // The v25 upgrade READS `concordReads` — a table the same version deletes,
  // and one that databases older than v23 never had at all. On those, Dexie
  // creates it while walking the intervening versions and the upgrader then
  // reads it empty. If that ever stopped working the upgrader would throw
  // inside `open()`, which is not a lost row but a database that will not open
  // — so the oldest ladders are walked here rather than assumed.
  for (const version of [5, 20, 22, 23]) {
    it(`opens a v${version} database without losing what was in it`, async () => {
      const name = scratchName();
      const old = new Dexie(name);
      old.version(version).stores({ profiles: "&pubkey", concordKv: "&key" });
      await old.open();
      await old.table("profiles").put({ pubkey: ME });
      old.close();

      const db = new GrimoireDb(name);
      await db.open();
      try {
        const tables = db.tables.map((t) => t.name);
        expect(tables).toContain("chatReads");
        expect(tables).not.toContain("concordReads");
        expect(await db.profiles.count()).toBe(1);
      } finally {
        db.close();
      }
    });
  }
});

describe("version 26: notification levels become protocol-qualified", () => {
  it("rewrites both rungs of the cascade and leaves no old key behind", async () => {
    const name = scratchName();
    await seedV24(name);

    const db = new GrimoireDb(name);
    await db.open();
    try {
      expect(
        await db.concordKv.get(containerLevelKey("concord", COMMUNITY)),
      ).toEqual({
        key: containerLevelKey("concord", COMMUNITY),
        value: "mentions",
      });
      expect(
        (await db.concordKv.get(channelLevelKey("concord", COMMUNITY, CHANNEL)))
          ?.value,
      ).toBe("nothing");
      expect(
        await db.concordKv.where("key").startsWith("c2notif:").count(),
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});
