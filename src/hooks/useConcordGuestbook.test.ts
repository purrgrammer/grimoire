/**
 * The guestbook's re-read, which is the only part of the hook with a decision
 * in it: the effect is keyed on the banlist, so the roster it holds is whatever
 * it closed over — and the roster is what says whether a kick was allowed.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { bytesToHex, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import type { Community } from "@/lib/concord/types";
import { controlScope, emitWireScopes } from "@/lib/concord/wire-bus";

const read = vi.hoisted(() =>
  vi.fn(async (_community: unknown, _folded: unknown) => []),
);

vi.mock("@/services/concord-members", () => ({ readGuestbookFeed: read }));

const { useConcordGuestbook } = await import("./useConcord");

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

function folded(moderators: string[]): FoldedControl {
  return {
    roster: {
      roles: [],
      grants: moderators.map((pubkey) => ({ pubkey })),
    } as unknown as FoldedControl["roster"],
    ownerHex: "aa".repeat(32),
    channels: new Map(),
    banned: new Set(),
    bannedAt: new Map(),
    heads: new Map(),
    incomplete: [],
  };
}

beforeEach(() => {
  read.mockClear();
});

describe("useConcordGuestbook", () => {
  it("answers a ring with the roster as it stands now", async () => {
    // The banlist did not change, so the effect does not re-run — but a member
    // promoted to moderator since the panel opened is exactly whose kicks the
    // stale roster would throw away as unauthorized.
    const c = community();
    const before = folded([]);
    const after = folded(["bb".repeat(32)]);
    const { rerender } = renderHook(
      ({ f }: { f: FoldedControl }) => useConcordGuestbook(c, f),
      { initialProps: { f: before } },
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(read.mock.calls[0][1]).toBe(before);

    rerender({ f: after });
    expect(read).toHaveBeenCalledTimes(1);

    emitWireScopes([controlScope(c.idHex)]);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read.mock.calls[1][1]).toBe(after);
  });
});
