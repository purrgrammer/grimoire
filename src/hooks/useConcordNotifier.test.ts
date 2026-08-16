/**
 * The wiring between a wire ring and an OS notification.
 *
 * `notify.ts` owns the judgement and has its own tests; what is only visible
 * here is the plumbing around it — that a ring resolves a bare channel id to a
 * community, that the same message arriving twice interrupts once, and that a
 * control ring drops the directory so a fresh banlist is used next time.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { BehaviorSubject } from "rxjs";

const addWindow = vi.hoisted(() => vi.fn());
const resolveChannel = vi.hoisted(() => vi.fn());
const invalidateChannelDirectory = vi.hoisted(() => vi.fn());
const resolveLevel = vi.hoisted(() => vi.fn());
const readLastRead = vi.hoisted(() => vi.fn(async () => 0));
const channelRumorsSince = vi.hoisted(() => vi.fn());

vi.mock("@/core/state", () => ({ useAddWindow: () => addWindow }));
vi.mock("@/services/concord-channel-directory", () => ({
  resolveChannel,
  invalidateChannelDirectory,
}));
vi.mock("@/services/concord-notif-prefs", () => ({
  resolveLevel,
  // The real predicate — the level cascade is not what is under test here, but
  // stubbing it away would let a broken gate order pass.
  levelAdmits: (level: string, mention: boolean) =>
    level === "nothing" ? false : level === "mentions" ? mention : true,
}));
vi.mock("@/services/concord-reads", () => ({
  readLastRead,
  CONCORD_READ_MAX_FUTURE_SECS: 3600,
}));
vi.mock("@/services/concord-rumor-store", () => ({
  channelRumorsSince,
  NOTIFY_SCAN_CAP: 20,
}));
vi.mock("@/services/profile-search", () => ({
  default: { getByPubkey: () => ({ displayName: "Alice" }) },
}));

const ME = "11".repeat(32);
const THEM = "22".repeat(32);
const COMMUNITY = "aa".repeat(32);
const CHANNEL = "bb".repeat(32);

vi.mock("@/services/accounts", () => ({
  default: { active$: new BehaviorSubject({ pubkey: ME }) },
}));

const { useConcordNotifier } = await import("./useConcordNotifier");
const { emitWireScopes, _resetWireBusForTests } =
  await import("@/lib/concord/wire-bus");
const { _resetNotifyForTests, registerActiveChannel } =
  await import("@/lib/concord/notify");
const { settingsManager } = await import("@/services/settings");

/** Every notification the page tried to raise. */
const raised: FakeNotification[] = [];

class FakeNotification {
  static permission = "granted";
  onclick: (() => void) | null = null;
  closed = false;
  constructor(
    readonly title: string,
    readonly options?: NotificationOptions,
  ) {
    raised.push(this);
  }
  close() {
    this.closed = true;
  }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "rumor-1",
  pubkey: THEM,
  created_at: Math.floor(Date.now() / 1000) + 5,
  content: "hello there",
  tags: [] as string[][],
  kind: 9,
  ...over,
});

beforeEach(() => {
  raised.length = 0;
  vi.clearAllMocks();
  _resetWireBusForTests();
  _resetNotifyForTests();
  vi.stubGlobal("Notification", FakeNotification);
  FakeNotification.permission = "granted";
  settingsManager.updateSetting("notifications", "enabled", true);
  resolveChannel.mockResolvedValue({
    communityId: COMMUNITY,
    communityName: "Alpha",
    channelIdHex: CHANNEL,
    channelName: "general",
    isPrivate: false,
    banned: new Set<string>(),
  });
  resolveLevel.mockResolvedValue("all");
  readLastRead.mockResolvedValue(0);
  channelRumorsSince.mockResolvedValue([row()]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  settingsManager.reset();
  _resetWireBusForTests();
});

describe("useConcordNotifier", () => {
  it("turns one ring into one notification", async () => {
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]?.title).toContain("general");
    // Tagged by channel so a burst collapses at the OS rather than stacking.
    expect(raised[0]?.options?.tag).toBe(CHANNEL);
  });

  it("does not raise the same message twice", async () => {
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(raised).toHaveLength(1));
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(channelRumorsSince).toHaveBeenCalledTimes(2));
    expect(raised).toHaveLength(1);
  });

  it("says nothing about the channel on screen", async () => {
    registerActiveChannel(CHANNEL);
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(channelRumorsSince).toHaveBeenCalled());
    expect(raised).toHaveLength(0);
  });

  it("says nothing when the setting is off", async () => {
    settingsManager.updateSetting("notifications", "enabled", false);
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(channelRumorsSince).toHaveBeenCalled());
    expect(raised).toHaveLength(0);
  });

  it("names the mention in the title", async () => {
    channelRumorsSince.mockResolvedValue([row({ tags: [["p", ME]] })]);
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]?.title).toContain("mentioned you");
  });

  it("ignores a ring for a channel this account cannot see", async () => {
    resolveChannel.mockResolvedValue(undefined);
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(resolveChannel).toHaveBeenCalled());
    expect(channelRumorsSince).not.toHaveBeenCalled();
    expect(raised).toHaveLength(0);
  });

  it("reads no rows at all for a silenced channel", async () => {
    resolveLevel.mockResolvedValue("nothing");
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(resolveLevel).toHaveBeenCalled());
    expect(channelRumorsSince).not.toHaveBeenCalled();
  });

  it("drops the directory when a control edition lands", async () => {
    // Otherwise a member banned five minutes ago keeps notifying: the banlist
    // the scan filters on is the one the directory cached.
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2ctl:${COMMUNITY}`]);
    await waitFor(() =>
      expect(invalidateChannelDirectory).toHaveBeenCalledTimes(1),
    );
    expect(channelRumorsSince).not.toHaveBeenCalled();
  });

  it("opens the community and channel it came from when clicked", async () => {
    renderHook(() => useConcordNotifier());
    emitWireScopes([`c2:${CHANNEL}`]);
    await waitFor(() => expect(raised).toHaveLength(1));
    raised[0]?.onclick?.();
    expect(addWindow).toHaveBeenCalledWith("concord", {
      communityId: COMMUNITY,
      channelId: CHANNEL,
    });
    expect(raised[0]?.closed).toBe(true);
  });
});
