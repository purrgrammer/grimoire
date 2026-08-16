import { beforeEach, describe, expect, it } from "vitest";
import { firstValueFrom } from "rxjs";
import { take, toArray } from "rxjs/operators";

import {
  CHAT_PREFS_STORAGE_KEY,
  channelPrefKey,
  concordPrefsManager,
  containerPrefKey,
  isCategoryCollapsed,
  isChannelPinned,
  lastChannelOf,
  loadPrefs,
  resetConcordPrefs,
} from "./concord-prefs";

const COMMUNITY = "a".repeat(64);
const OTHER_COMMUNITY = "b".repeat(64);
const CHANNEL = "c".repeat(64);
const OTHER_CHANNEL = "d".repeat(64);

const stored = () =>
  JSON.parse(localStorage.getItem(CHAT_PREFS_STORAGE_KEY) ?? "null");

beforeEach(() => {
  localStorage.removeItem(CHAT_PREFS_STORAGE_KEY);
  resetConcordPrefs();
});

describe("key shape", () => {
  it("qualifies a container with its protocol", () => {
    expect(containerPrefKey("concord", COMMUNITY)).toBe(`concord|${COMMUNITY}`);
    expect(containerPrefKey("nip-29", "wss://Relay.example/")).toBe(
      "nip-29|wss://relay.example/",
    );
  });

  it("separates the channel rung with the same pipe", () => {
    expect(channelPrefKey("concord", COMMUNITY, CHANNEL)).toBe(
      `concord|${COMMUNITY}|${CHANNEL}`,
    );
  });

  it("keeps a NIP-29 relay from colliding with a Concord community", () => {
    // The whole reason the protocol is in the key: two containers can spell the
    // same id, and only the discriminator tells the rows apart.
    expect(containerPrefKey("concord", "abc")).not.toBe(
      containerPrefKey("nip-29", "abc"),
    );
  });

  it("casefolds both id segments", () => {
    expect(channelPrefKey("concord", COMMUNITY.toUpperCase(), "AB")).toBe(
      `concord|${COMMUNITY}|ab`,
    );
  });
});

describe("pins", () => {
  it("round-trips through storage", () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    expect(isChannelPinned(concordPrefsManager.value, COMMUNITY, CHANNEL)).toBe(
      true,
    );
    expect(stored().pinnedChannels).toEqual([
      channelPrefKey("concord", COMMUNITY, CHANNEL),
    ]);
    expect(isChannelPinned(loadPrefs(), COMMUNITY, CHANNEL)).toBe(true);
  });

  it("unpins on a second toggle", () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    expect(concordPrefsManager.value.pinnedChannels).toEqual([]);
  });

  it("does not pin the same channel id in another community", () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    expect(
      isChannelPinned(concordPrefsManager.value, OTHER_COMMUNITY, CHANNEL),
    ).toBe(false);
  });

  it("ignores a blank id rather than storing a half key", () => {
    concordPrefsManager.togglePin("", CHANNEL);
    concordPrefsManager.togglePin(COMMUNITY, "");
    expect(concordPrefsManager.value.pinnedChannels).toEqual([]);
  });
});

describe("collapsed categories", () => {
  it("collapses and re-opens", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(
      isCategoryCollapsed(concordPrefsManager.value, COMMUNITY, "voice"),
    ).toBe(true);
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(
      isCategoryCollapsed(concordPrefsManager.value, COMMUNITY, "voice"),
    ).toBe(false);
  });

  it("leaves no empty array behind for a community with nothing collapsed", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(concordPrefsManager.value.collapsedCategories).toEqual({});
    expect(stored().collapsedCategories).toEqual({});
  });

  it("keeps two communities' folds apart", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(
      isCategoryCollapsed(concordPrefsManager.value, OTHER_COMMUNITY, "voice"),
    ).toBe(false);
    expect(Object.keys(concordPrefsManager.value.collapsedCategories)).toEqual([
      containerPrefKey("concord", COMMUNITY),
    ]);
  });
});

describe("last open channel", () => {
  it("remembers per community", () => {
    concordPrefsManager.setLastChannel(COMMUNITY, CHANNEL);
    concordPrefsManager.setLastChannel(OTHER_COMMUNITY, OTHER_CHANNEL);
    expect(lastChannelOf(concordPrefsManager.value, COMMUNITY)).toBe(CHANNEL);
    expect(lastChannelOf(concordPrefsManager.value, OTHER_COMMUNITY)).toBe(
      OTHER_CHANNEL,
    );
  });

  it("does not emit when the channel has not moved", async () => {
    concordPrefsManager.setLastChannel(COMMUNITY, CHANNEL);
    const emissions = firstValueFrom(
      concordPrefsManager.stream$.pipe(take(2), toArray()),
    );
    concordPrefsManager.setLastChannel(COMMUNITY, CHANNEL); // no-op
    concordPrefsManager.setLastChannel(COMMUNITY, OTHER_CHANNEL);
    const seen = await emissions;
    // The replayed current value, then the real move — never the no-op.
    expect(seen.map((p) => lastChannelOf(p, COMMUNITY))).toEqual([
      CHANNEL,
      OTHER_CHANNEL,
    ]);
  });
});

describe("loading a damaged blob", () => {
  it("falls back to defaults on unparseable JSON", () => {
    localStorage.setItem(CHAT_PREFS_STORAGE_KEY, "{not json");
    expect(loadPrefs()).toEqual({
      __version: 1,
      pinnedChannels: [],
      collapsedCategories: {},
      lastChannelByContainer: {},
    });
  });

  it("keeps the fields it can still read", () => {
    localStorage.setItem(
      CHAT_PREFS_STORAGE_KEY,
      JSON.stringify({
        __version: 1,
        pinnedChannels: [channelPrefKey("concord", COMMUNITY, CHANNEL), 7],
        collapsedCategories: "nonsense",
        lastChannelByContainer: {
          [containerPrefKey("concord", COMMUNITY)]: CHANNEL,
        },
      }),
    );
    const prefs = loadPrefs();
    expect(prefs.pinnedChannels).toEqual([
      channelPrefKey("concord", COMMUNITY, CHANNEL),
    ]);
    expect(prefs.collapsedCategories).toEqual({});
    expect(lastChannelOf(prefs, COMMUNITY)).toBe(CHANNEL);
  });
});

describe("reset", () => {
  it("empties storage and tells its subscribers", async () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    concordPrefsManager.setLastChannel(COMMUNITY, CHANNEL);

    const emissions = firstValueFrom(
      concordPrefsManager.stream$.pipe(take(2), toArray()),
    );
    resetConcordPrefs();
    const seen = await emissions;

    expect(seen[1]).toEqual({
      __version: 1,
      pinnedChannels: [],
      collapsedCategories: {},
      lastChannelByContainer: {},
    });
    expect(localStorage.getItem(CHAT_PREFS_STORAGE_KEY)).toBeNull();
    expect(loadPrefs().pinnedChannels).toEqual([]);
  });
});
