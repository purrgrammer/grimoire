/**
 * The three things the hook owns and the scan service does not: waiting for
 * the typing to stop, abandoning the run a keystroke superseded, and hearing
 * the wire say a channel has new messages in it.
 *
 * Driven through `renderHook` because all three are about effect timing — none
 * of them is visible from calling `searchConcordMessages` directly.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { bytesToHex, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import type { Channel, Community } from "@/lib/concord/types";
import { channelScope, emitWireScopes } from "@/lib/concord/wire-bus";
import type { ConcordSearchHit } from "@/services/concord-search";

const scan = vi.hoisted(() =>
  vi.fn(
    async (
      _c: unknown,
      _f: unknown,
      _ch: unknown,
      filters: { query: string },
      opts?: { signal?: AbortSignal },
    ): Promise<ConcordSearchHit[]> => {
      if (opts?.signal?.aborted) return [];
      return [
        {
          channelIdHex: "cc".repeat(32),
          channelName: "general",
          channelPrivate: false,
          message: {
            rumorId: filters.query,
            author: "aa".repeat(32),
            kind: 9,
            content: filters.query,
            tags: [],
            createdAt: 1,
            ms: 1000,
            channelIdHex: "cc".repeat(32),
            epoch: 0n,
          },
        },
      ];
    },
  ),
);

vi.mock("@/services/concord-search", () => ({ searchConcordMessages: scan }));

const { useConcordSearch } = await import("./useConcordSearch");

const CHANNEL = "cc".repeat(32);

function community(): Community {
  const id = random32();
  return {
    id,
    idHex: bytesToHex(id),
    owner: "aa".repeat(32),
    ownerSalt: random32(),
    root: random32(),
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: random32() }],
    privateChannels: [],
    relays: [],
    name: "Test",
  };
}

function folded(): FoldedControl {
  return {
    roster: { roles: [], grants: [] },
    ownerHex: "aa".repeat(32),
    channels: new Map(),
    banned: new Set(),
    bannedAt: new Map(),
    heads: new Map(),
    incomplete: [],
  };
}

const channels = [{ idHex: CHANNEL, name: "general" } as Channel];

beforeEach(() => {
  scan.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useConcordSearch", () => {
  it("does not scan at all below the minimum query length", async () => {
    const c = community();
    renderHook(() =>
      useConcordSearch(c, folded(), channels, { query: "o", channelIds: [] }),
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(scan).not.toHaveBeenCalled();
  });

  it("reports itself searching until the scan answers", async () => {
    const c = community();
    const { result } = renderHook(() =>
      useConcordSearch(c, folded(), channels, {
        query: "otter",
        channelIds: [],
      }),
    );
    expect(result.current.active).toBe(true);
    expect(result.current.searching).toBe(true);
    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.hits).toHaveLength(1);
  });

  it("scans once for a query typed one letter at a time", async () => {
    // The debounce, which is the difference between one scan and five.
    const c = community();
    const f = folded();
    const { rerender } = renderHook(
      ({ query }: { query: string }) =>
        useConcordSearch(c, f, channels, { query, channelIds: [] }),
      { initialProps: { query: "ot" } },
    );
    rerender({ query: "ott" });
    rerender({ query: "otte" });
    rerender({ query: "otter" });
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
    expect(scan.mock.calls[0][3].query).toBe("otter");
  });

  it("shows nothing while a superseded query is still on screen", async () => {
    // A stale answer under a changed query looks right, which is worse than
    // showing nothing at all.
    const c = community();
    const f = folded();
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useConcordSearch(c, f, channels, { query, channelIds: [] }),
      { initialProps: { query: "otter" } },
    );
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    rerender({ query: "badger" });
    expect(result.current.hits).toEqual([]);
    expect(result.current.searching).toBe(true);
    await waitFor(() =>
      expect(result.current.hits[0]?.message.content).toBe("badger"),
    );
  });

  it("re-scans when the wire says an in-scope channel changed", async () => {
    const c = community();
    const { result } = renderHook(() =>
      useConcordSearch(c, folded(), channels, {
        query: "otter",
        channelIds: [],
      }),
    );
    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(scan).toHaveBeenCalledTimes(1);

    emitWireScopes([channelScope(CHANNEL)]);
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
  });

  it("says it is waiting, not searching, before the community has folded", async () => {
    // Typing into the box on a cold start schedules no scan at all. Calling
    // that "searching…" claims work nobody is doing, and a community whose
    // control plane never resolves would claim it forever.
    const c = community();
    const { result, rerender } = renderHook(
      ({ f }: { f: FoldedControl | undefined }) =>
        useConcordSearch(c, f, channels, {
          query: "otter",
          channelIds: [],
        }),
      { initialProps: { f: undefined as FoldedControl | undefined } },
    );
    expect(result.current.waiting).toBe(true);
    expect(result.current.searching).toBe(false);
    await new Promise((r) => setTimeout(r, 400));
    expect(scan).not.toHaveBeenCalled();

    rerender({ f: folded() });
    expect(result.current.waiting).toBe(false);
    expect(result.current.searching).toBe(true);
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
  });

  it("keeps the results on screen while a ring is being re-scanned", async () => {
    // A ring does not make the hits wrong the way a changed query does — it
    // only makes them possibly short by one message. Blanking the pane on every
    // message that lands in a busy community would make the list unreadable.
    const c = community();
    const { result } = renderHook(() =>
      useConcordSearch(c, folded(), channels, {
        query: "otter",
        channelIds: [],
      }),
    );
    await waitFor(() => expect(result.current.hits).toHaveLength(1));

    emitWireScopes([channelScope(CHANNEL)]);
    await waitFor(() => expect(result.current.searching).toBe(true));
    expect(result.current.hits).toHaveLength(1);
    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.hits).toHaveLength(1);
  });

  it("ignores a ring from a channel outside the search scope", async () => {
    const c = community();
    const { result } = renderHook(() =>
      useConcordSearch(c, folded(), channels, {
        query: "otter",
        channelIds: [],
      }),
    );
    await waitFor(() => expect(result.current.searching).toBe(false));

    emitWireScopes([channelScope("ee".repeat(32))]);
    await new Promise((r) => setTimeout(r, 400));
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("stops scanning when the search is cleared", async () => {
    const c = community();
    const f = folded();
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useConcordSearch(c, f, channels, { query, channelIds: [] }),
      { initialProps: { query: "otter" } },
    );
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    rerender({ query: "" });
    expect(result.current.active).toBe(false);
    expect(result.current.searching).toBe(false);
    expect(result.current.hits).toEqual([]);
  });
});
