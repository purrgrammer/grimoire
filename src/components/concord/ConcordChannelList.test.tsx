// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ChannelList } from "./ConcordChannelList";
import {
  CHAT_PREFS_STORAGE_KEY,
  concordPrefsManager,
  isCategoryCollapsed,
  isChannelPinned,
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

describe("ChannelList pins", () => {
  it("lifts a pinned channel out of its category to the top", () => {
    concordPrefsManager.togglePin(COMMUNITY, "random".padEnd(64, "0"));
    renderList();
    // Once, not twice — a pinned channel leaves the category it came from.
    expect(screen.getAllByText("random")).toHaveLength(1);
    expect(screen.getByText("general")).toBeTruthy();
  });

  it("keeps a pinned channel visible even when its category is folded", () => {
    // The point of a pin: always where the reader can see it. A pin that could
    // be folded away would be two arrangements arguing.
    concordPrefsManager.togglePin(COMMUNITY, "random".padEnd(64, "0"));
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "text");
    renderList();
    expect(screen.getByText("random")).toBeTruthy();
    expect(screen.queryByText("general")).toBeNull();
  });

  it("marks a pinned row without a heading, so pinning cannot change the height", () => {
    // A heading would add a line the moment anything is pinned, moving every
    // row under the cursor. The mark rides inside the row instead.
    renderList();
    expect(screen.queryByText("pinned")).toBeNull();
    concordPrefsManager.togglePin(COMMUNITY, "random".padEnd(64, "0"));
    renderList();
    expect(screen.queryByText("pinned")).toBeNull();
  });

  it("stores a pin under a protocol-qualified community and channel key", () => {
    concordPrefsManager.togglePin(COMMUNITY, "stage".padEnd(64, "0"));
    expect(concordPrefsManager.value.pinnedChannels).toEqual([
      `concord|${COMMUNITY}|${"stage".padEnd(64, "0")}`,
    ]);
  });
});

describe("the row's context menu", () => {
  // Radix menus need pointer APIs jsdom is short on; these pass because the
  // menu is opened by a contextmenu event rather than a pointer gesture. If a
  // Radix upgrade ever breaks that, unit-invoke the handlers instead of
  // deleting the coverage.
  it("pins from the menu, and offers to unpin next time", async () => {
    renderList();
    fireEvent.contextMenu(screen.getByText("stage"));
    fireEvent.click(await screen.findByText("Pin"));

    expect(
      isChannelPinned(
        concordPrefsManager.value,
        COMMUNITY,
        "stage".padEnd(64, "0"),
      ),
    ).toBe(true);

    fireEvent.contextMenu(screen.getAllByText("stage")[0]);
    fireEvent.click(await screen.findByText("Unpin"));
    expect(
      isChannelPinned(
        concordPrefsManager.value,
        COMMUNITY,
        "stage".padEnd(64, "0"),
      ),
    ).toBe(false);
  });

  it("offers Pin and nothing else while notifications are hidden", async () => {
    renderList();
    fireEvent.contextMenu(screen.getByText("lobby"));
    expect(await screen.findByText("Pin")).toBeTruthy();
    // The notification levels used to live in this menu. They are hidden with
    // the rest of that subsystem, so the menu is one verb wide.
    expect(screen.queryByText("Notify me about lobby")).toBeNull();
    expect(screen.queryByText("Mentions only")).toBeNull();
  });
});
