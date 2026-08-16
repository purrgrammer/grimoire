// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ChannelList } from "./ConcordChannelList";
import {
  CHAT_PREFS_STORAGE_KEY,
  concordPrefsManager,
  isCategoryCollapsed,
  resetConcordPrefs,
} from "@/services/concord-prefs";
import type { Channel } from "@/lib/concord/types";
import type { ChannelUnread } from "@/services/concord-rumor-store";

const COMMUNITY = "a".repeat(64);

const channel = (name: string, category?: string): Channel =>
  ({
    id: new Uint8Array(32),
    idHex: name.padEnd(64, "0"),
    name,
    isPrivate: false,
    ...(category ? { category } : {}),
    streams: [],
  }) as unknown as Channel;

const CHANNELS = [
  channel("lobby"),
  channel("general", "Text"),
  channel("random", "Text"),
  channel("stage", "Voice"),
];

const renderList = (
  overrides: {
    selected?: string;
    unread?: Map<string, ChannelUnread>;
  } = {},
) =>
  render(
    <ChannelList
      channels={CHANNELS}
      communityId={COMMUNITY}
      selected={overrides.selected}
      loading={false}
      error={undefined}
      unread={overrides.unread ?? new Map()}
      onSelect={vi.fn()}
    />,
  );

beforeEach(() => {
  localStorage.removeItem(CHAT_PREFS_STORAGE_KEY);
  resetConcordPrefs();
});

describe("ChannelList categories", () => {
  it("shows every channel while nothing is folded", () => {
    renderList();
    for (const name of ["lobby", "general", "random", "stage"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("folds one category shut without touching the others", () => {
    renderList();
    fireEvent.click(screen.getByText("Text"));

    expect(screen.queryByText("general")).toBeNull();
    expect(screen.queryByText("random")).toBeNull();
    // The heading stays — a fold has to be undoable from the sidebar.
    expect(screen.getByText("Text")).toBeTruthy();
    // Neither the other category nor the uncategorized run moves.
    expect(screen.getByText("stage")).toBeTruthy();
    expect(screen.getByText("lobby")).toBeTruthy();
  });

  it("opens again on a second click", () => {
    renderList();
    fireEvent.click(screen.getByText("Text"));
    fireEvent.click(screen.getByText("Text"));
    expect(screen.getByText("general")).toBeTruthy();
  });

  it("stores the fold under a protocol-qualified community key", () => {
    renderList();
    fireEvent.click(screen.getByText("Voice"));
    expect(
      isCategoryCollapsed(concordPrefsManager.value, COMMUNITY, "voice"),
    ).toBe(true);
    expect(Object.keys(concordPrefsManager.value.collapsedCategories)).toEqual([
      `concord|${COMMUNITY}`,
    ]);
  });

  it("renders folded when the device already had it folded", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "text");
    renderList();
    expect(screen.queryByText("general")).toBeNull();
  });

  it("keeps a channel with messages waiting visible under a folded heading", () => {
    // Folding quiets a sidebar; it must not swallow the badge that is the whole
    // reason someone glances at one.
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "text");
    renderList({
      unread: new Map([
        [
          "general".padEnd(64, "0"),
          { count: 3, mention: false } as ChannelUnread,
        ],
      ]),
    });
    expect(screen.getByText("general")).toBeTruthy();
    expect(screen.queryByText("random")).toBeNull();
  });

  it("keeps the channel being read visible under a folded heading", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "text");
    renderList({ selected: "random".padEnd(64, "0") });
    expect(screen.getByText("random")).toBeTruthy();
    expect(screen.queryByText("general")).toBeNull();
  });
});
