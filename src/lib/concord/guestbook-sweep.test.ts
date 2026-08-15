/**
 * The Guestbook sweep's FORWARD cursor — the half of `plane-sync.ts` that is
 * deliberately unlike the control sweep beside it.
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
import { queryPlane } from "@/services/concord-rumor-store";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

import { bytesToHex, guestbookGroupKey, random32 } from "./derive";
import { KIND_JOIN_LEAVE, KIND_SEAL_ENCRYPTED } from "./kinds";
import {
  _configureAuthWaitForTests,
  _resetGuestbookCursorsForTests,
  _resetPlaneSweepForTests,
  guestbookScopeKey,
  sweepGuestbook,
} from "./plane-sync";
import {
  _resetStreamAuthRegistry,
  authenticateStreams,
  registerStreamKeys,
} from "./stream-auth";
import { buildRumor, sealRumor, wrapSeal } from "./stream";
import type { Community } from "./types";

let relay: MockRelay | undefined;
let pool: RelayPool | undefined;

const root = random32();
const communityId = random32();
const gb = guestbookGroupKey(root, communityId, 0n);

function community(relays: string[], over: Partial<Community> = {}): Community {
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
    ...over,
  };
}

/** A real Join on the wire: encrypted-sealed, wrapped at `createdAt`. */
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
  // `wrapSeal` stamps from the clock; the cursor rides `created_at`, so the wrap
  // has to sit where the test puts it.
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

const NOW = Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordKv.clear();
  _resetPlaneSweepForTests();
  await _resetGuestbookCursorsForTests();
  _resetStreamAuthRegistry();
  _configureAuthWaitForTests(50);
});

afterEach(async () => {
  vi.restoreAllMocks();
  pool?.close();
  pool = undefined;
  await relay?.close();
  relay = undefined;
});

describe("sweepGuestbook", () => {
  it("decrypts and stores the guestbook, then resumes forward of the cursor", async () => {
    const events = [await joinWrap(NOW - 300)];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    const fresh = await sweepGuestbook(c, { pool });
    expect(fresh).toHaveLength(1);
    expect(await queryPlane(c.idHex, "guestbook")).toHaveLength(1);

    // The second sweep asks forward of what it read, rather than re-reading.
    await sweepGuestbook(c, { pool });
    const asks = relay.reqFilters();
    expect(asks).toHaveLength(2);
    expect(asks[0].since).toBeUndefined();
    expect(asks[1].since).toBe(NOW - 300);
  });

  it("persists the cursor, so a fresh session does not re-read the plane", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [await joinWrap(NOW - 300)],
    });
    pool = new RelayPool();
    const c = community([relay.url]);
    await sweepGuestbook(c, { pool });

    // Forget the in-memory half only — the persisted cursor must survive.
    _resetPlaneSweepForTests();
    await sweepGuestbook(c, { pool });
    expect(relay.reqFilters()[1].since).toBe(NOW - 300);
  });

  it("re-baselines on an epoch advance — a cursor from the old read scope cannot gate it", async () => {
    // A rekey adoption changes WHAT THE MEMBER CAN READ, so the first sweep at
    // the new epoch must be a full backfill.
    relay = await startMockRelay({
      kind: "paged",
      events: [await joinWrap(NOW - 300)],
    });
    pool = new RelayPool();
    const c = community([relay.url]);
    await sweepGuestbook(c, { pool });

    const rotated = community([relay.url], {
      rootEpoch: 1n,
      heldRoots: [
        { epoch: 1n, key: root },
        { epoch: 0n, key: root },
      ],
    });
    await sweepGuestbook(rotated, { pool });
    expect(relay.reqFilters()[1].since).toBeUndefined();
  });

  it("sweeps EVERY held epoch's guestbook, not just the current one", async () => {
    // Unlike the control plane, the guestbook is not compaction-bounded: prior
    // epochs' Joins and Kicks stay the only record for anyone a snapshot
    // predates.
    const older = random32();
    relay = await startMockRelay({ kind: "paged", events: [] });
    pool = new RelayPool();
    const c = community([relay.url], {
      rootEpoch: 1n,
      heldRoots: [
        { epoch: 1n, key: root },
        { epoch: 0n, key: older },
      ],
    });
    await sweepGuestbook(c, { pool });
    const authors = relay.reqFilters()[0].authors ?? [];
    expect(authors).toHaveLength(2);
    expect(authors).toContain(guestbookGroupKey(root, communityId, 1n).pk);
    expect(authors).toContain(guestbookGroupKey(older, communityId, 0n).pk);
  });

  it("clamps a future-stamped entry to the local clock", async () => {
    // One entry stamped ahead — a skewed clock, or a hostile timestamp any
    // member can mint — would otherwise drag the cursor past `now` and every
    // later REQ would open with `since > now`. Permanently: the cursor is durable.
    const future = NOW + 86_400;
    relay = await startMockRelay({
      kind: "paged",
      events: [await joinWrap(future)],
    });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepGuestbook(c, { pool });
    await sweepGuestbook(c, { pool });
    const since = relay.reqFilters()[1].since;
    expect(since).toBeDefined();
    expect(since!).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("re-asks behind the auth gate after a refused read", async () => {
    relay = await startMockRelay({
      kind: "nip42-gated",
      events: [await joinWrap(NOW - 300)],
    });
    pool = new RelayPool();
    const c = community([relay.url]);
    _configureAuthWaitForTests(3_000);
    registerStreamKeys([{ pk: gb.pk, sk: gb.sk }], [relay.url]);
    // Stand in for the lifecycle wiring (`concord-stream-auth.ts`): answer the
    // challenge the moment the socket reports one, concurrently with the read
    // that is about to be refused.
    const socket = pool.relay(relay.url);
    const answering = socket.challenge$.subscribe((challenge) => {
      if (challenge) void authenticateStreams(socket).catch(() => undefined);
    });

    const out = await sweepGuestbook(c, { pool });
    answering.unsubscribe();
    expect(relay.authedPubkeys()).toContain(gb.pk);
    expect(out).toHaveLength(1);
  }, 15_000);

  it("leaves the cursor put when the relay refuses outright", async () => {
    relay = await startMockRelay({ kind: "auth-required" });
    pool = new RelayPool();
    const c = community([relay.url]);

    expect(await sweepGuestbook(c, { pool })).toHaveLength(0);
    expect(
      await db.concordKv.get(
        `guestbook-cursor:${guestbookScopeKey(c, relay.url)}`,
      ),
    ).toBeUndefined();
  });

  it("single-flights concurrent sweeps of one scope", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [await joinWrap(NOW - 300)],
    });
    pool = new RelayPool();
    const c = community([relay.url]);

    const [a, b] = await Promise.all([
      sweepGuestbook(c, { pool }),
      sweepGuestbook(c, { pool }),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // One REQ, not two racing to advance one cursor.
    expect(relay.reqFilters()).toHaveLength(1);
  });
});
