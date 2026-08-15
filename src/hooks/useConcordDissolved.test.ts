/**
 * The dissolution poll. Both of this hook's defects shipped because it had no
 * test: the purge never ran for a dissolved community, and a live community
 * inherited the previous one's badge.
 *
 * Driven through `renderHook` rather than by hand, because the bugs are about
 * effect ORDER and about state surviving a prop change — neither is visible
 * from calling the services directly.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { bytesToHex, random32 } from "@/lib/concord/derive";
import type { Community } from "@/lib/concord/types";

const swept = vi.hoisted(() => vi.fn(async () => 0));
const dissolvedOf = vi.hoisted(() => new Map<string, number>());

vi.mock("@/services/concord-expiry", () => ({
  sweepExpiredRumors: swept,
}));
vi.mock("@/services/concord-dissolution", () => ({
  syncDissolved: async (community: Community) =>
    dissolvedOf.get(community.idHex),
}));

const { useConcordDissolved } = await import("./useConcordDissolved");

function community(name: string): Community {
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
    name,
  };
}

beforeEach(() => {
  swept.mockClear();
  dissolvedOf.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useConcordDissolved", () => {
  it("reports a tombstone for the community it was asked about", async () => {
    const dead = community("Dead");
    dissolvedOf.set(dead.idHex, 7_000);
    const { result } = renderHook(() => useConcordDissolved(dead));
    await waitFor(() => expect(result.current).toBe(7_000));
  });

  it("does NOT carry a verdict across a community switch", async () => {
    // The viewer switches communities IN PLACE, so state that outlives the
    // prop puts a dissolved badge on a live community for the rest of the
    // session.
    const dead = community("Dead");
    const alive = community("Alive");
    dissolvedOf.set(dead.idHex, 7_000);

    const { result, rerender } = renderHook(
      ({ c }: { c: Community }) => useConcordDissolved(c),
      { initialProps: { c: dead } },
    );
    await waitFor(() => expect(result.current).toBe(7_000));

    rerender({ c: alive });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(swept).toHaveBeenCalledTimes(2));
    expect(result.current).toBeUndefined();
  });

  it("purges expired rumors even for a DISSOLVED community", async () => {
    // The case the purge exists for most: a dead community whose history
    // nobody will re-open. The terminal early-return used to skip it.
    const dead = community("Dead");
    dissolvedOf.set(dead.idHex, 7_000);
    const { result } = renderHook(() => useConcordDissolved(dead));
    await waitFor(() => expect(result.current).toBe(7_000));
    expect(swept).toHaveBeenCalled();
  });

  it("keeps polling a live community, sweeping each round", async () => {
    vi.useFakeTimers();
    const alive = community("Alive");
    renderHook(() => useConcordDissolved(alive));
    await vi.waitFor(() => expect(swept).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    await vi.waitFor(() => expect(swept).toHaveBeenCalledTimes(2));
  });
});
