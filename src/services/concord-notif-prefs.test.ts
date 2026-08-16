/**
 * The cascade is the whole feature: a level set on a channel has to beat its
 * community, a community's has to beat the app default, and clearing one has to
 * fall back rather than mean "nothing".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetNotifPrefsForTests,
  channelLevelKey,
  containerLevelKey,
  ensureNotifPrefsLoaded,
  inheritedLevelSync,
  levelAdmits,
  onNotifPrefsChange,
  resetNotifPrefsMemory,
  resolveLevel,
  resolveLevelSync,
  setChannelLevel,
  setCommunityLevel,
} from "@/services/concord-notif-prefs";
import { settingsManager } from "@/services/settings";
import db from "@/services/db";

const ALPHA = "aa".repeat(32);
const GENERAL = "c1".repeat(32);
const RANDOM = "c9".repeat(32);

beforeEach(async () => {
  await _resetNotifPrefsForTests();
  settingsManager.updateSetting("notifications", "defaultLevel", "mentions");
});

afterEach(async () => {
  await _resetNotifPrefsForTests();
  settingsManager.reset();
});

describe("the cascade", () => {
  it("falls back to the app default when nothing is set", async () => {
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("mentions");
    settingsManager.updateSetting("notifications", "defaultLevel", "all");
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("all");
  });

  it("lets a community override the app default", async () => {
    await setCommunityLevel(ALPHA, "nothing");
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("nothing");
    // And only for its own channels.
    expect(await resolveLevel("bb".repeat(32), GENERAL)).toBe("mentions");
  });

  it("lets a channel override its community", async () => {
    await setCommunityLevel(ALPHA, "nothing");
    await setChannelLevel(ALPHA, GENERAL, "all");
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("all");
    expect(await resolveLevel(ALPHA, RANDOM)).toBe("nothing");
  });

  it("inherits again once an override is cleared", async () => {
    await setCommunityLevel(ALPHA, "all");
    await setChannelLevel(ALPHA, GENERAL, "nothing");
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("nothing");
    await setChannelLevel(ALPHA, GENERAL, undefined);
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("all");
    await setCommunityLevel(ALPHA, undefined);
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("mentions");
  });

  it("is case-insensitive about ids, like every other Concord key", async () => {
    await setChannelLevel(ALPHA.toUpperCase(), GENERAL.toUpperCase(), "all");
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("all");
  });
});

describe("what clearing an override would leave", () => {
  it("is the community's level for a channel, not the channel's own", async () => {
    // The menu entry that clears the override names this. Naming the RESOLVED
    // level instead would read "Use community default (all messages)" here and
    // silence the channel on click.
    await setCommunityLevel(ALPHA, "nothing");
    await setChannelLevel(ALPHA, GENERAL, "all");
    await ensureNotifPrefsLoaded();
    expect(resolveLevelSync(ALPHA, GENERAL)).toBe("all");
    expect(inheritedLevelSync(ALPHA, GENERAL)).toBe("nothing");
  });

  it("holds the other way round too — a muted channel under a loud community", async () => {
    await setCommunityLevel(ALPHA, "all");
    await setChannelLevel(ALPHA, GENERAL, "nothing");
    await ensureNotifPrefsLoaded();
    expect(inheritedLevelSync(ALPHA, GENERAL)).toBe("all");
  });

  it("is the app default for a community, whatever the community is set to", async () => {
    await setCommunityLevel(ALPHA, "nothing");
    await ensureNotifPrefsLoaded();
    expect(inheritedLevelSync(ALPHA)).toBe("mentions");
    settingsManager.updateSetting("notifications", "defaultLevel", "all");
    expect(inheritedLevelSync(ALPHA)).toBe("all");
  });

  it("agrees with the resolved level when nothing is overridden", async () => {
    await ensureNotifPrefsLoaded();
    expect(inheritedLevelSync(ALPHA, GENERAL)).toBe(
      resolveLevelSync(ALPHA, GENERAL),
    );
  });
});

describe("persistence", () => {
  it("survives a reload — the memo is a cache, not the store", async () => {
    await setChannelLevel(ALPHA, GENERAL, "all");
    await setCommunityLevel(ALPHA, "nothing");
    resetNotifPrefsMemory();
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("all");
    expect(await resolveLevel(ALPHA, RANDOM)).toBe("nothing");
  });

  it("clears the row rather than storing an 'inherit' value", async () => {
    await setChannelLevel(ALPHA, GENERAL, "all");
    expect(
      await db.concordKv.get(channelLevelKey("concord", ALPHA, GENERAL)),
    ).toBeTruthy();
    await setChannelLevel(ALPHA, GENERAL, undefined);
    expect(
      await db.concordKv.get(channelLevelKey("concord", ALPHA, GENERAL)),
    ).toBeUndefined();
  });

  it("keys a level by protocol, so another protocol's cannot claim it", async () => {
    await setCommunityLevel(ALPHA, "nothing");
    // The row a NIP-29 writer would leave for a container whose id happens to
    // spell the same string. Without the protocol segment the two families
    // share a key and the loudest write wins.
    await db.concordKv.put({
      key: containerLevelKey("nip-29", ALPHA),
      value: "all",
    });
    resetNotifPrefsMemory();
    await ensureNotifPrefsLoaded();
    expect(resolveLevelSync(ALPHA, GENERAL)).toBe("nothing");
  });

  it("ignores a row whose value is not a level", async () => {
    await db.concordKv.put({
      key: containerLevelKey("concord", ALPHA),
      value: "loud",
    });
    resetNotifPrefsMemory();
    await ensureNotifPrefsLoaded();
    expect(resolveLevelSync(ALPHA, GENERAL)).toBe("mentions");
  });

  it("loads once however many callers race for it", async () => {
    await setCommunityLevel(ALPHA, "all");
    resetNotifPrefsMemory();
    const spy = vi.spyOn(db.concordKv, "where");
    await Promise.all([
      ensureNotifPrefsLoaded(),
      ensureNotifPrefsLoaded(),
      ensureNotifPrefsLoaded(),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("repaints the open menus when the account leaves", () => {
    // Logout runs with the sidebar mounted. Without the ring, every context
    // menu keeps its pre-logout checkmark until something else re-renders.
    const repaint = vi.fn();
    const unsubscribe = onNotifPrefsChange(repaint);
    resetNotifPrefsMemory();
    expect(repaint).toHaveBeenCalled();
    unsubscribe();
  });

  it("forgets everything in memory when the account leaves", async () => {
    await setCommunityLevel(ALPHA, "nothing");
    // What logout does: the rows go with `db.concordKv.clear()`, the memo with
    // this. Without the second, the tab keeps answering "nothing" for the next
    // person to sign in.
    await db.concordKv.clear();
    resetNotifPrefsMemory();
    expect(await resolveLevel(ALPHA, GENERAL)).toBe("mentions");
  });
});

describe("levelAdmits", () => {
  it("admits everything at 'all'", () => {
    expect(levelAdmits("all", false)).toBe(true);
    expect(levelAdmits("all", true)).toBe(true);
  });

  it("admits only a mention at 'mentions'", () => {
    expect(levelAdmits("mentions", false)).toBe(false);
    expect(levelAdmits("mentions", true)).toBe(true);
  });

  it("admits nothing at 'nothing' — a mention included", () => {
    expect(levelAdmits("nothing", false)).toBe(false);
    expect(levelAdmits("nothing", true)).toBe(false);
  });
});
