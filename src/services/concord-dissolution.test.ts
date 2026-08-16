/**
 * Finding the grave, and never losing it again.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelayPool } from "applesauce-relay";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import { bytesToHex, dissolvedGroupKey, random32 } from "@/lib/concord/derive";
import {
  KIND_CONTROL,
  KIND_SEAL_PLAINTEXT,
  VSK_DISSOLVED,
} from "@/lib/concord/kinds";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { Community } from "@/lib/concord/types";
import {
  _resetDissolutionForTests,
  resetDissolutionMemory,
  dissolvedAt,
  syncDissolved,
} from "@/services/concord-dissolution";
import db from "@/services/db";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

let relay: MockRelay | undefined;
let pool: RelayPool | undefined;

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const communityId = random32();
const idHex = bytesToHex(communityId);

function community(): Community {
  return {
    id: communityId,
    idHex,
    owner,
    ownerSalt: random32(),
    root: random32(),
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: random32() }],
    privateChannels: [],
    relays: relay ? [relay.url] : [],
    name: "Test",
  };
}

async function tombstone(sk: Uint8Array = ownerSk): Promise<NostrEvent> {
  const group = dissolvedGroupKey(communityId);
  const rumor = buildRumor({
    kind: KIND_CONTROL,
    content: "",
    tags: [
      ["vsk", VSK_DISSOLVED],
      ["eid", idHex],
    ],
    pubkey: getPublicKey(sk),
    ms: 7_000,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, group, {
    signEvent: async (t) => finalizeEvent(t, sk),
  });
  return wrapSeal(seal, group);
}

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordKv.clear();
  await _resetDissolutionForTests();
});

afterEach(async () => {
  pool?.close();
  pool = undefined;
  await relay?.close();
  relay = undefined;
});

describe("syncDissolved", () => {
  it("finds a tombstone on the wire and remembers it terminally", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [await tombstone()],
    });
    pool = new RelayPool();

    expect(await syncDissolved(community(), { pool })).toBe(7_000);
    // Recorded, so the gates can answer without a network round.
    expect(await dissolvedAt(idHex)).toBe(7_000);

    // ONE-WAY, and it must not depend on the rumor store: with the stored
    // tombstone purged AND the relay serving nothing, the verdict still stands.
    // A later empty read reviving a dead community is exactly what "terminal"
    // forbids, and the rumor store is not durable — a CORD-08 purge or a schema
    // bump can empty it.
    await db.concordRumors.clear();
    await relay.close();
    relay = await startMockRelay({ kind: "paged", events: [] });
    expect(await syncDissolved(community(), { pool })).toBe(7_000);
  });

  it("survives losing the session memo, because the verdict is persisted", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [await tombstone()],
    });
    pool = new RelayPool();
    await syncDissolved(community(), { pool });

    // A fresh launch: the memo is gone but the Dexie row is not. Wiping both
    // would make this pass against the surviving Map.
    resetDissolutionMemory();
    expect(await dissolvedAt(idHex)).toBe(7_000);
  });

  it("does NOT record an impostor's event at the address", async () => {
    // The address derives from the community_id alone, which ships in every
    // invite — so anyone can publish here, and only the owner's signature
    // counts.
    relay = await startMockRelay({
      kind: "paged",
      events: [await tombstone(generateSecretKey())],
    });
    pool = new RelayPool();

    expect(await syncDissolved(community(), { pool })).toBeUndefined();
    expect(await dissolvedAt(idHex)).toBeUndefined();
  });

  it("reads a tombstone already in the store without touching the network", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [await tombstone()],
    });
    pool = new RelayPool();
    await syncDissolved(community(), { pool });
    await _resetDissolutionForTests();

    const before = relay.reqFilters().length;
    expect(await syncDissolved(community(), { pool })).toBe(7_000);
    expect(relay.reqFilters()).toHaveLength(before);
  });

  it("stays undefined when no relay answers", async () => {
    relay = await startMockRelay({ kind: "auth-required" });
    pool = new RelayPool();
    expect(await syncDissolved(community(), { pool })).toBeUndefined();
  });
});
