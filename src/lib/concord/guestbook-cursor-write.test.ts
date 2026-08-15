/**
 * The one place this port narrows armada's Guestbook sweep: a forward cursor
 * must not advance over a failed store write.
 *
 * Its own file because it needs the store module mocked, and a module mock is
 * not something the rest of the sweep's tests should run under.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayPool } from "applesauce-relay";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import db from "@/services/db";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

import { bytesToHex, guestbookGroupKey, random32 } from "./derive";
import { KIND_JOIN_LEAVE, KIND_SEAL_ENCRYPTED } from "./kinds";
import {
  _resetGuestbookCursorsForTests,
  _resetPlaneSweepForTests,
  sweepGuestbook,
} from "./plane-sync";
import { buildRumor, sealRumor, wrapSeal } from "./stream";
import type { Community } from "./types";

const writeFails = vi.hoisted(() => ({ value: false }));
vi.mock("@/services/concord-rumor-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/concord-rumor-store")>();
  return {
    ...actual,
    writeOpened: (...args: Parameters<typeof actual.writeOpened>) =>
      writeFails.value
        ? Promise.resolve({ ok: false, wrapIds: [] })
        : actual.writeOpened(...args),
  };
});

let relay: MockRelay | undefined;
let pool: RelayPool | undefined;

const root = random32();
const communityId = random32();
const gb = guestbookGroupKey(root, communityId, 0n);
const NOW = Math.floor(Date.now() / 1000);

function community(relays: string[]): Community {
  return {
    id: communityId,
    idHex: bytesToHex(communityId),
    owner: "aa".repeat(32),
    ownerSalt: random32(),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays,
    name: "Test",
  };
}

async function joinWrap(createdAt: number): Promise<NostrEvent> {
  const author = generateSecretKey();
  const rumor = buildRumor({
    kind: KIND_JOIN_LEAVE,
    content: "join",
    tags: [],
    pubkey: getPublicKey(author),
    createdAtSecs: createdAt,
    ms: null,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, gb, {
    signEvent: async (t) =>
      finalizeEvent({ ...t, created_at: createdAt }, author),
  });
  const wrapped = wrapSeal(seal, gb);
  return finalizeEvent(
    {
      kind: wrapped.kind,
      content: wrapped.content,
      tags: wrapped.tags,
      created_at: createdAt,
    },
    gb.sk,
  );
}

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordKv.clear();
  _resetPlaneSweepForTests();
  await _resetGuestbookCursorsForTests();
  writeFails.value = false;
});

afterEach(async () => {
  pool?.close();
  pool = undefined;
  await relay?.close();
  relay = undefined;
});

describe("sweepGuestbook cursor", () => {
  it("does NOT advance when the store write fails", async () => {
    // Armada advances this cursor without checking the write. A forward cursor
    // is the one place that cannot be forgiven: a `since` filter never serves
    // these wraps again, and the seen-memo offers no second chance either, so
    // advancing over a failed Dexie write loses them for good.
    relay = await startMockRelay({
      kind: "paged",
      events: [await joinWrap(NOW - 300)],
    });
    pool = new RelayPool();
    const c = community([relay.url]);

    writeFails.value = true;
    expect(await sweepGuestbook(c, { pool })).toHaveLength(0);
    writeFails.value = false;

    await sweepGuestbook(c, { pool });
    // Still asking from the beginning — nothing was ever durably stored.
    expect(relay.reqFilters()[1].since).toBeUndefined();
  });
});
