/**
 * The rekey watch end to end: a real rotation on a mock relay, wrapped under a
 * real rekey address, with a real pairwise-encrypted blob.
 *
 * Nothing here mints anything the way armada does — the fixtures below ARE the
 * rotator, because grimoire never rotates and ships no builder.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelayPool } from "applesauce-relay";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
} from "nostr-tools";
import type { NostrEvent } from "nostr-tools";

import type { FoldedControl } from "@/lib/concord/control";
import {
  baseRekeyGroupKey,
  bytesToHex,
  channelRekeyGroupKey,
  epochKeyCommitment,
  grantLocator,
  hexToBytes,
  random32,
  type GroupKey,
} from "@/lib/concord/derive";
import { KIND_REKEY, KIND_SEAL_ENCRYPTED } from "@/lib/concord/kinds";
import { myLocator, ROOT_SCOPE_HEX } from "@/lib/concord/rekey";
import { Permissions } from "@/lib/concord/roles";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { Community } from "@/lib/concord/types";
import {
  applyAdoption,
  readAdoption,
  writeAdoption,
} from "@/services/concord-adoptions";
import {
  _configureRekeyPagingForTests,
  _resetRekeyCursorsForTests,
  watchBaseRekey,
  watchChannelRekeys,
} from "@/services/concord-rekey-watch";
import { _resetDissolutionForTests } from "@/services/concord-dissolution";
import db from "@/services/db";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

let relay: MockRelay | undefined;
let pool: RelayPool | undefined;

const root = random32();
const communityId = random32();
const idHex = bytesToHex(communityId);
const channelId = random32();
const channelKey = random32();

/** The rotator: an owner, so no `vac` citation is needed. */
const rotatorSk = generateSecretKey();
const rotator = getPublicKey(rotatorSk);
/** The viewer, holding a real key so the pairwise ECDH is real. */
const meSk = generateSecretKey();
const me = getPublicKey(meSk);

const NOW = Math.floor(Date.now() / 1000);
const JOINED_MS = (NOW - 3600) * 1000;

function community(over: Partial<Community> = {}): Community {
  return {
    id: communityId,
    idHex,
    owner: rotator,
    ownerSalt: random32(),
    root,
    rootEpoch: 1n,
    heldRoots: [{ epoch: 1n, key: root }],
    privateChannels: [
      { id: channelId, key: channelKey, epoch: 1n, name: "#p" },
    ],
    relays: relay ? [relay.url] : [],
    name: "Test",
    ...over,
  };
}

function folded(over: Partial<FoldedControl> = {}): FoldedControl {
  return {
    roster: { roles: [], grants: [] },
    ownerHex: rotator,
    channels: new Map(),
    banned: new Set(),
    bannedAt: new Map(),
    heads: new Map(),
    incomplete: [],
    ...over,
  };
}

const viewer = {
  pubkey: me,
  signer: {
    nip44: {
      decrypt: async (pubkey: string, ciphertext: string) =>
        nip44.decrypt(ciphertext, nip44.getConversationKey(meSk, pubkey)),
    },
  },
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** `scope_id[32] ‖ epoch_be[8] ‖ new_key[32]`, plus the base tail if given. */
function wrappedPlain(
  scopeId: Uint8Array,
  epoch: bigint,
  newKey: Uint8Array,
  controlPk?: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(controlPk ? 104 : 72);
  out.set(scopeId, 0);
  new DataView(out.buffer).setBigUint64(32, epoch, false);
  out.set(newKey, 40);
  if (controlPk) out.set(controlPk, 72);
  return out;
}

/**
 * One rotation chunk on the wire: a 3303 rumor, encrypted-sealed by the
 * rotator's real key, wrapped under the rekey address.
 */
async function rotationWrap(opts: {
  address: GroupKey;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevKey: Uint8Array;
  blobs: Array<{ locator: string; wrapped: string }>;
  chunk?: [number, number];
  createdAt?: number;
  vac?: string[];
  rotatorSk?: Uint8Array;
}): Promise<NostrEvent> {
  const chunk = opts.chunk ?? [1, 1];
  const signSk = opts.rotatorSk ?? rotatorSk;
  const signPk = getPublicKey(signSk);
  const createdAt = opts.createdAt ?? NOW - 60;
  const rumor = buildRumor({
    kind: KIND_REKEY,
    content: JSON.stringify(opts.blobs),
    tags: [
      ["scope", opts.scopeIdHex],
      ["newepoch", opts.newEpoch.toString()],
      ["prevepoch", opts.prevEpoch.toString()],
      [
        "prevcommit",
        bytesToHex(epochKeyCommitment(opts.prevEpoch, opts.prevKey)),
      ],
      ["chunk", chunk[0].toString(), chunk[1].toString()],
      ...(opts.vac ? [opts.vac] : []),
    ],
    pubkey: signPk,
    createdAtSecs: createdAt,
    ms: null,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, opts.address, {
    signEvent: async (t) =>
      finalizeEvent({ ...t, created_at: createdAt }, signSk),
  });
  const wrapped = wrapSeal(seal, opts.address);
  return finalizeEvent(
    {
      kind: wrapped.kind,
      content: wrapped.content,
      tags: wrapped.tags,
      created_at: createdAt,
    },
    opts.address.sk!,
  );
}

/** A blob addressed to the viewer, pairwise-encrypted by the rotator. */
function blobForMe(
  plain: Uint8Array,
  scopeIdHex: string,
  epoch: bigint,
  fromSk: Uint8Array = rotatorSk,
) {
  return {
    locator: myLocator(getPublicKey(fromSk), me, scopeIdHex, epoch),
    wrapped: nip44.encrypt(
      bytesToBase64(plain),
      nip44.getConversationKey(fromSk, me),
    ),
  };
}

/**
 * A fold in which `actor` holds `permission` at `position`, plus the `vac` tag
 * their rotation must cite (CORD-04 §5). Without the citation an authorized
 * non-owner is refused outright, so this is the only way to reach a rotation
 * that IS authorized and still does not outrank the viewer.
 */
function foldWithGrant(
  actor: string,
  permission: bigint,
  position: number,
): { fold: FoldedControl; vac: string[] } {
  const eid = bytesToHex(grantLocator(communityId, hexToBytes(actor)));
  const hash = "ab".repeat(32);
  return {
    fold: folded({
      ownerHex: "ff".repeat(32),
      heads: new Map([[eid, { version: 1n, hash: hexToBytes(hash) }]]),
      roster: {
        roles: [
          {
            roleId: "r1",
            name: "Staff",
            position,
            permissions: permission,
            scope: { kind: "server" as const },
            color: 0,
          },
        ],
        grants: [
          { member: actor, roleIds: ["r1"] },
          { member: me, roleIds: ["r1"] },
        ],
      },
    }),
    vac: ["vac", eid, "1", hash],
  };
}

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordAdoptions.clear();
  await db.concordKv.clear();
  await _resetRekeyCursorsForTests();
  // The dissolution verdict is a SESSION memo as well as a row — clearing the
  // table alone leaves a buried community buried for every later test.
  await _resetDissolutionForTests();
});

afterEach(async () => {
  _configureRekeyPagingForTests(200);
  pool?.close();
  pool = undefined;
  await relay?.close();
  relay = undefined;
});

describe("watchBaseRekey", () => {
  const nextEpoch = 2n;
  const newRoot = random32();
  const address = () => baseRekeyGroupKey(root, communityId, nextEpoch);

  it("adopts a complete, authorized, continuity-checked rotation", async () => {
    const blob = blobForMe(
      wrappedPlain(new Uint8Array(32), nextEpoch, newRoot),
      ROOT_SCOPE_HEX,
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchBaseRekey(
      community(),
      folded(),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result).toEqual({ adopted: true, excluded: false, stranded: false });

    // …and the adoption layers onto the community the next read produces.
    const row = await readAdoption(me, idHex);
    const { community: rotated } = applyAdoption(community(), row);
    expect(rotated.rootEpoch).toBe(nextEpoch);
    expect(bytesToHex(rotated.root)).toBe(bytesToHex(newRoot));
    expect(rotated.refounder).toBe(rotator);
    // The prior root stays held, with the rotation's publish time as its
    // hard read cutoff.
    const prior = rotated.heldRoots.find((r) => r.epoch === 1n);
    expect(bytesToHex(prior!.key)).toBe(bytesToHex(root));
    expect(prior!.retiredAt).toBeGreaterThan(0);
  });

  it("carries the next epoch's control address out of a 104-byte blob", async () => {
    const controlPk = random32();
    const blob = blobForMe(
      wrappedPlain(new Uint8Array(32), nextEpoch, newRoot, controlPk),
      ROOT_SCOPE_HEX,
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    const { community: rotated } = applyAdoption(
      community(),
      await readAdoption(me, idHex),
    );
    expect(rotated.controlPk).toBe(bytesToHex(controlPk));
  });

  it("does NOT adopt a rotation from an unauthorized rotator", async () => {
    // A removed member still holding the prior root can construct a perfect
    // rotation. Authority is the roster, never key possession.
    const blob = blobForMe(
      wrappedPlain(new Uint8Array(32), nextEpoch, newRoot),
      ROOT_SCOPE_HEX,
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    // Someone else owns the community, and the rotator holds no BAN.
    const result = await watchBaseRekey(
      community(),
      folded({ ownerHex: "ff".repeat(32) }),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.adopted).toBe(false);
    expect(await readAdoption(me, idHex)).toBeUndefined();
  });

  it("does NOT adopt from a BANNED rotator, even one who could otherwise act", async () => {
    const blob = blobForMe(
      wrappedPlain(new Uint8Array(32), nextEpoch, newRoot),
      ROOT_SCOPE_HEX,
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchBaseRekey(
      community(),
      folded({ banned: new Set([rotator]) }),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.adopted).toBe(false);
  });

  it("does NOT adopt a rotation that does not extend the key we hold", async () => {
    // Continuity is the proof the rotation is OURS to take. Waiving it lets one
    // authorized rotator fork a lagging member onto a branch neither can see.
    const blob = blobForMe(
      wrappedPlain(new Uint8Array(32), nextEpoch, newRoot),
      ROOT_SCOPE_HEX,
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: random32(), // a different chain
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchBaseRekey(
      community(),
      folded(),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.adopted).toBe(false);
  });

  it("treats a MISSING CHUNK as neither an adoption nor a removal", async () => {
    // Only once all `n` chunks are held and none carries our locator have we
    // been removed. A missing chunk is never an exclusion.
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
          chunk: [1, 2],
        }),
      ],
    });
    pool = new RelayPool();

    expect(
      await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }),
    ).toEqual({ adopted: false, excluded: false, stranded: false });
  });

  it("records an exclusion when a complete rotation carries no blob for us", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchBaseRekey(
      community(),
      folded(),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result).toEqual({ adopted: false, excluded: true, stranded: false });
    expect((await readAdoption(me, idHex))?.excludedAtEpoch).toBe("2");
  });

  it("reports a rotation that PREDATES our join as a STRAND, not a removal", async () => {
    // A stale public invite drops a joiner ONTO a historical Refounding: it is
    // complete, continuity-valid, and has no blob at their locator. Reading
    // that as a removal ejects every fresh joiner seconds after they arrive.
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
          createdAt: NOW - 7200, // before JOINED_MS
        }),
      ],
    });
    pool = new RelayPool();

    // Neither an adoption nor an exclusion — and the third answer matters,
    // because there is no forward path on the wire: the rekey for the epoch we
    // hold was minted before our pubkey existed, so it can never carry our
    // blob. Only a refreshed link or a direct invite heals it, and the reader
    // has to be told that rather than left staring at an unreadable community.
    expect(
      await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }),
    ).toEqual({ adopted: false, excluded: false, stranded: true });
  });
});

describe("the join-time guard", () => {
  const nextEpoch = 2n;

  it("does not cut us out on a base rotation from a peer who does not outrank us", async () => {
    // CORD-06 §Authority on the BASE half: "the Rotator must strictly outrank
    // every removed target". Every other base test uses the owner, who
    // outranks everyone, so this is the only one the gate is reachable from.
    const { fold, vac } = foldWithGrant(rotator, Permissions.BAN, 1);
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
          vac,
        }),
      ],
    });
    pool = new RelayPool();
    expect(
      (await watchBaseRekey(community(), fold, viewer, JOINED_MS, { pool }))
        .excluded,
    ).toBe(false);
  });

  it("does not cut us from a CHANNEL on a rotation that predates our join", async () => {
    // A stale public invite lands a joiner on a channel epoch the community has
    // already rotated past. That rotation is history they were never part of,
    // and reading it as a removal takes the room away seconds after they arrive.
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: channelRekeyGroupKey(root, channelId, nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
          createdAt: NOW - 7200, // before JOINED_MS
        }),
      ],
    });
    pool = new RelayPool();
    expect(
      await watchChannelRekeys(community(), folded(), viewer, JOINED_MS, {
        pool,
      }),
    ).toEqual({ adopted: false, excluded: false, stranded: false });
  });
});

describe("the strand signal", () => {
  const nextEpoch = 2n;

  it("does NOT strand on a rotation from someone who does not outrank us", async () => {
    // Tested on the join time, not on the negation of "could exclude me": a
    // peer's rotation is not our removal AND not our strand — it is simply not
    // about us. Negating the conjunction would route every peer-rank rotation
    // here and tell the user their invite link is stale when it is fine.
    const { fold, vac } = foldWithGrant(rotator, Permissions.BAN, 1);
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
          vac,
          // AFTER our join, so it is the exclusion branch that is being
          // declined, not the strand branch.
          createdAt: NOW - 60,
        }),
      ],
    });
    pool = new RelayPool();
    expect(
      await watchBaseRekey(community(), fold, viewer, JOINED_MS, { pool }),
    ).toEqual({ adopted: false, excluded: false, stranded: false });
  });

  it("does not strand when the rotation carried our blob after all", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [
            blobForMe(
              wrappedPlain(new Uint8Array(32), nextEpoch, random32()),
              ROOT_SCOPE_HEX,
              nextEpoch,
            ),
          ],
          createdAt: NOW - 7200, // predates the join, but addressed to us
        }),
      ],
    });
    pool = new RelayPool();
    const out = await watchBaseRekey(community(), folded(), viewer, JOINED_MS, {
      pool,
    });
    expect(out.adopted).toBe(true);
    expect(out.stranded).toBe(false);
  });
});

describe("channel cursor housekeeping", () => {
  it("drops the cursors of windows it has stopped watching", async () => {
    // The scope key names the exact (channel, epoch) set, so every adoption
    // mints a new one and abandons the last. Nothing collected them.
    relay = await startMockRelay({ kind: "paged", events: [] });
    pool = new RelayPool();

    await db.concordKv.put({
      key: `rekey-cursor:chan:${idHex}:stale-window|${relay.url}`,
      value: 1_700_000_000,
    });
    await watchChannelRekeys(community(), folded(), viewer, JOINED_MS, {
      pool,
    });
    // Give the fire-and-forget prune a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const left = await db.concordKv
      .where("key")
      .startsWith(`rekey-cursor:chan:${idHex}:`)
      .primaryKeys();
    expect(left.some((k) => String(k).includes("stale-window"))).toBe(false);
  });
});

describe("watchChannelRekeys", () => {
  const nextEpoch = 2n;
  const newChannelKey = random32();
  const address = (epoch: bigint) =>
    channelRekeyGroupKey(root, channelId, epoch);

  it("adopts a channel rotation and retains the key it steps off", async () => {
    const blob = blobForMe(
      wrappedPlain(channelId, nextEpoch, newChannelKey),
      bytesToHex(channelId),
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchChannelRekeys(
      community(),
      folded(),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.adopted).toBe(true);

    const { community: rotated } = applyAdoption(
      community(),
      await readAdoption(me, idHex),
    );
    const channel = rotated.privateChannels[0];
    expect(channel.epoch).toBe(nextEpoch);
    expect(bytesToHex(channel.key)).toBe(bytesToHex(newChannelKey));
    // The prior generation stays readable — dropping it would trade a rotation
    // for a hole in the conversation.
    expect(bytesToHex(channel.priors![0].key)).toBe(bytesToHex(channelKey));
    expect(channel.priors![0].retiredAt).toBeGreaterThan(0);
  });

  it("walks a two-epoch gap in one pass, retaining every key it passes", async () => {
    // The lookahead window is what makes this reachable at all: a member who
    // missed epoch 2 would otherwise poll an address that is never published
    // to again.
    const mid = random32();
    const end = random32();
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(2n),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: 2n,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, 2n, mid),
              bytesToHex(channelId),
              2n,
            ),
          ],
        }),
        await rotationWrap({
          address: address(3n),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: 3n,
          prevEpoch: 2n,
          prevKey: mid,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, 3n, end),
              bytesToHex(channelId),
              3n,
            ),
          ],
        }),
      ],
    });
    pool = new RelayPool();

    await watchChannelRekeys(community(), folded(), viewer, JOINED_MS, {
      pool,
    });
    const { community: rotated } = applyAdoption(
      community(),
      await readAdoption(me, idHex),
    );
    const channel = rotated.privateChannels[0];
    expect(channel.epoch).toBe(3n);
    expect(bytesToHex(channel.key)).toBe(bytesToHex(end));
    expect(channel.priors!.map((p) => bytesToHex(p.key))).toEqual([
      bytesToHex(mid),
      bytesToHex(channelKey),
    ]);
  });

  it("refuses a blob minted for the BASE spliced onto a channel", async () => {
    // Scope binds inside the ciphertext. The event's tags say this channel; the
    // blob says the root, so it is not a key we can carry forward.
    const blob = blobForMe(
      wrappedPlain(new Uint8Array(32), nextEpoch, newChannelKey),
      bytesToHex(channelId),
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchChannelRekeys(
      community(),
      folded(),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.adopted).toBe(false);
  });

  it("drops a channel a rotation cut us out of", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchChannelRekeys(
      community(),
      folded(),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.excluded).toBe(true);

    const { community: cut } = applyAdoption(
      community(),
      await readAdoption(me, idHex),
    );
    expect(cut.privateChannels).toHaveLength(0);
  });

  it("does NOT cut us out on a rotation from someone who does not outrank us", async () => {
    // CORD-06 §Authority: "the Rotator must strictly outrank every removed
    // target". A peer's rotation is no more our removal than a forged one. The
    // rotator here IS authorized — same role, cited Grant — and equal rank is
    // the only thing stopping it.
    const { fold, vac } = foldWithGrant(
      rotator,
      Permissions.MANAGE_CHANNELS,
      1,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
          vac,
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchChannelRekeys(
      community(),
      fold,
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.excluded).toBe(false);

    // The SAME rotation from someone who OUTRANKS us is our removal — which is
    // what proves the rank comparison is doing the work above.
    await db.concordAdoptions.clear();
    const senior = foldWithGrant(rotator, Permissions.MANAGE_CHANNELS, 1);
    senior.fold.roster.roles.push({
      roleId: "r0",
      name: "Boss",
      position: 0,
      permissions: Permissions.MANAGE_CHANNELS,
      scope: { kind: "server" as const },
      color: 0,
    });
    senior.fold.roster.grants = [
      { member: rotator, roleIds: ["r0"] },
      { member: me, roleIds: ["r1"] },
    ];
    expect(
      (
        await watchChannelRekeys(community(), senior.fold, viewer, JOINED_MS, {
          pool,
        })
      ).excluded,
    ).toBe(true);
  });

  it("lets a LATER exclusion override an earlier adoption", async () => {
    // The walk is ascending and the newest word wins: a key handed to us at
    // epoch 2 does not survive a rotation at epoch 3 that skipped us. Keeping
    // the adoption would leave a room in the sidebar we were already cut from.
    const mid = random32();
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(2n),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: 2n,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, 2n, mid),
              bytesToHex(channelId),
              2n,
            ),
          ],
        }),
        await rotationWrap({
          address: address(3n),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: 3n,
          prevEpoch: 2n,
          prevKey: mid,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        }),
      ],
    });
    pool = new RelayPool();

    const result = await watchChannelRekeys(
      community(),
      folded(),
      viewer,
      JOINED_MS,
      { pool },
    );
    expect(result.excluded).toBe(true);
    expect(result.adopted).toBe(false);

    const { community: cut } = applyAdoption(
      community(),
      await readAdoption(me, idHex),
    );
    expect(cut.privateChannels).toHaveLength(0);
  });

  it("does NOT adopt a channel rotation off a key we do not hold", async () => {
    // Continuity gates ADOPTION epoch by epoch as the chain is walked. A
    // rotation addressed to us but minted off a different key would fork us
    // onto a branch neither side can detect.
    const blob = blobForMe(
      wrappedPlain(channelId, nextEpoch, newChannelKey),
      bytesToHex(channelId),
      nextEpoch,
    );
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: address(nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: random32(), // a different chain
          blobs: [blob],
        }),
      ],
    });
    pool = new RelayPool();

    // Addressed to us, so it is not a removal either — the window keeps polling
    // in case the missing link shows up.
    expect(
      await watchChannelRekeys(community(), folded(), viewer, JOINED_MS, {
        pool,
      }),
    ).toEqual({ adopted: false, excluded: false, stranded: false });
  });
});

describe("the CORD-04 §5 citation gate", () => {
  const nextEpoch = 2n;
  const newRoot = random32();

  /** A rotation from an authorized non-owner, citing `vac`. */
  async function rotationCiting(vac: string[]): Promise<MockRelay> {
    return startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [
            blobForMe(
              wrappedPlain(new Uint8Array(32), nextEpoch, newRoot),
              ROOT_SCOPE_HEX,
              nextEpoch,
            ),
          ],
          vac,
        }),
      ],
    });
  }

  it("adopts from an authorized non-owner citing the Grant we folded", async () => {
    const { fold, vac } = foldWithGrant(rotator, Permissions.BAN, 1);
    relay = await rotationCiting(vac);
    pool = new RelayPool();
    expect(
      (await watchBaseRekey(community(), fold, viewer, JOINED_MS, { pool }))
        .adopted,
    ).toBe(true);
  });

  it("REFUSES the same rotation citing a Grant version we have not read", async () => {
    // The whole community's keys turn on this: a just-demoted admin's
    // Refounding must not be honored by a client one sweep behind. Citing v9
    // when our fold is at v1 means we cannot confirm the authority — fail
    // closed and let it self-heal when the Grant arrives.
    const { fold, vac } = foldWithGrant(rotator, Permissions.BAN, 1);
    relay = await rotationCiting([vac[0], vac[1], "9", vac[3]]);
    pool = new RelayPool();
    expect(
      (await watchBaseRekey(community(), fold, viewer, JOINED_MS, { pool }))
        .adopted,
    ).toBe(false);
  });

  it("REFUSES a rotation citing a non-canonical fork of its own Grant", async () => {
    const { fold, vac } = foldWithGrant(rotator, Permissions.BAN, 1);
    relay = await rotationCiting([vac[0], vac[1], vac[2], "cd".repeat(32)]);
    pool = new RelayPool();
    expect(
      (await watchBaseRekey(community(), fold, viewer, JOINED_MS, { pool }))
        .adopted,
    ).toBe(false);
  });

  it("REFUSES an authorized non-owner rotation with no citation at all", async () => {
    const { fold } = foldWithGrant(rotator, Permissions.BAN, 1);
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [
            blobForMe(
              wrappedPlain(new Uint8Array(32), nextEpoch, newRoot),
              ROOT_SCOPE_HEX,
              nextEpoch,
            ),
          ],
        }),
      ],
    });
    pool = new RelayPool();
    expect(
      (await watchBaseRekey(community(), fold, viewer, JOINED_MS, { pool }))
        .adopted,
    ).toBe(false);
  });
});

describe("idempotence", () => {
  const nextEpoch = 2n;

  it("does not re-adopt a channel rotation it has already recorded", async () => {
    // The loop this closes: the walk reads the `Community` prop, which only
    // advances when the caller reloads the list — so without a check against
    // what is STORED, every poll re-adopted the same rotation and appended
    // another copy of the key it stepped off, forever.
    const newKey = random32();
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: channelRekeyGroupKey(root, channelId, nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, nextEpoch, newKey),
              bytesToHex(channelId),
              nextEpoch,
            ),
          ],
        }),
      ],
    });
    pool = new RelayPool();

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await watchChannelRekeys(community(), folded(), viewer, JOINED_MS, {
          pool,
        }),
      );
    }
    expect(results.map((r) => r.adopted)).toEqual([true, false, false]);
    const row = await readAdoption(me, idHex);
    expect(row?.channels[0].priors).toHaveLength(1);
  });

  it("does not duplicate a prior the stored row already carries", async () => {
    // Reachable whenever the stored row leads the Community: the walk steps off
    // epoch 1, and the row already lists epoch 1 as a prior. A prior is a KEY,
    // and every duplicate becomes a stream key the reader derives and
    // subscribes at.
    const two = random32();
    const three = random32();
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: channelRekeyGroupKey(root, channelId, 2n),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: 2n,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, 2n, two),
              bytesToHex(channelId),
              2n,
            ),
          ],
        }),
        await rotationWrap({
          address: channelRekeyGroupKey(root, channelId, 3n),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: 3n,
          prevEpoch: 2n,
          prevKey: two,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, 3n, three),
              bytesToHex(channelId),
              3n,
            ),
          ],
        }),
      ],
    });
    pool = new RelayPool();

    // The row already knows about epoch 2, with epoch 1 retained behind it —
    // the state a previous poll left before the list caught up.
    await writeAdoption(me, idHex, {
      channels: [
        {
          idHex: bytesToHex(channelId),
          epoch: "2",
          key: bytesToHex(two),
          priors: [{ epoch: "1", key: bytesToHex(channelKey) }],
        },
      ],
    });

    // The Community is still at epoch 1, so the walk re-steps 1 → 2 → 3.
    await watchChannelRekeys(community(), folded(), viewer, JOINED_MS, {
      pool,
    });
    const stored = await readAdoption(me, idHex);
    const epochs = (stored?.channels[0].priors ?? []).map((p) => p.epoch);
    expect(epochs).toEqual([...new Set(epochs)]);
    expect(epochs.sort()).toEqual(["1", "2"]);
  });

  it("reports an adoption even when another channel was cut in the same pass", async () => {
    // `adopted && !excluded` hid this, so the caller never reloaded, so the
    // adoption never reached the `Community` — and the walk repeated forever.
    const otherId = random32();
    const otherKey = random32();
    const newKey = random32();
    const c = () =>
      community({
        privateChannels: [
          { id: channelId, key: channelKey, epoch: 1n, name: "#a" },
          { id: otherId, key: otherKey, epoch: 1n, name: "#b" },
        ],
      });
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: channelRekeyGroupKey(root, channelId, nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, nextEpoch, newKey),
              bytesToHex(channelId),
              nextEpoch,
            ),
          ],
        }),
        await rotationWrap({
          address: channelRekeyGroupKey(root, otherId, nextEpoch),
          scopeIdHex: bytesToHex(otherId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: otherKey,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        }),
      ],
    });
    pool = new RelayPool();

    const first = await watchChannelRekeys(c(), folded(), viewer, JOINED_MS, {
      pool,
    });
    expect(first).toEqual({ adopted: true, excluded: true, stranded: false });
    // And the second pass is quiet, so the caller is asked to reload once.
    expect(
      await watchChannelRekeys(c(), folded(), viewer, JOINED_MS, { pool }),
    ).toEqual({ adopted: false, excluded: false, stranded: false });
  });

  it("does not re-announce a base adoption it has already recorded", async () => {
    const newRoot = random32();
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [
            blobForMe(
              wrappedPlain(new Uint8Array(32), nextEpoch, newRoot),
              ROOT_SCOPE_HEX,
              nextEpoch,
            ),
          ],
        }),
      ],
    });
    pool = new RelayPool();
    expect(
      (await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }))
        .adopted,
    ).toBe(true);
    expect(
      (await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }))
        .adopted,
    ).toBe(false);
  });

  it("does not re-announce a base exclusion it has already recorded", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        }),
      ],
    });
    pool = new RelayPool();
    expect(
      (await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }))
        .excluded,
    ).toBe(true);
    expect(
      (await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }))
        .excluded,
    ).toBe(false);
  });
});

describe("the dissolution guard", () => {
  const nextEpoch = 2n;

  /** Record the community as dissolved the way a real probe would. */
  const bury = () =>
    db.concordKv.put({ key: `concord-dissolved:${idHex}`, value: 5_000 });

  it("refuses to advance the ROOT past the owner's tombstone", async () => {
    // Death wins every race (CORD-02 §9): a Refounding never crosses it.
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [
            blobForMe(
              wrappedPlain(new Uint8Array(32), nextEpoch, random32()),
              ROOT_SCOPE_HEX,
              nextEpoch,
            ),
          ],
        }),
      ],
    });
    pool = new RelayPool();
    await bury();

    expect(
      await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }),
    ).toEqual({ adopted: false, excluded: false, stranded: false });
    // Not even a request: the grave is checked before any address is derived.
    expect(relay.reqFilters()).toHaveLength(0);
  });

  it("refuses to advance a CHANNEL past it either", async () => {
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: channelRekeyGroupKey(root, channelId, nextEpoch),
          scopeIdHex: bytesToHex(channelId),
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: channelKey,
          blobs: [
            blobForMe(
              wrappedPlain(channelId, nextEpoch, random32()),
              bytesToHex(channelId),
              nextEpoch,
            ),
          ],
        }),
      ],
    });
    pool = new RelayPool();
    await bury();

    expect(
      await watchChannelRekeys(community(), folded(), viewer, JOINED_MS, {
        pool,
      }),
    ).toEqual({ adopted: false, excluded: false, stranded: false });
    expect(relay.reqFilters()).toHaveLength(0);
  });
});

describe("the rekey cursor", () => {
  it("advances per relay once the rounds are stored, and resumes from it", async () => {
    const nextEpoch = 2n;
    const created = NOW - 120;
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
          createdAt: created,
        }),
      ],
    });
    pool = new RelayPool();

    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    const asks = relay.reqFilters();
    expect(asks[0].since).toBeUndefined();
    expect(asks[1].since).toBe(created);
  });

  it("pages past the relay's per-filter limit before advancing", async () => {
    // A rotation deeper than one page: without the walk, the cursor would jump
    // to the newest chunk and the ones below it would never be asked for again.
    const nextEpoch = 2n;
    const address = baseRekeyGroupKey(root, communityId, nextEpoch);
    const chunk = (n: number, createdAt: number) =>
      rotationWrap({
        address,
        scopeIdHex: ROOT_SCOPE_HEX,
        newEpoch: nextEpoch,
        prevEpoch: 1n,
        prevKey: root,
        blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        chunk: [n, 3],
        createdAt,
      });
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await chunk(1, NOW - 300),
        await chunk(2, NOW - 200),
        await chunk(3, NOW - 100),
      ],
    });
    pool = new RelayPool();
    _configureRekeyPagingForTests(2);

    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });

    // All three chunks landed, not just the newest page…
    const stored = await db.concordRumors
      .where("communityId")
      .equals(idHex)
      .toArray();
    expect(stored.filter((r) => r.kind === KIND_REKEY)).toHaveLength(3);
    // …and only then did the cursor move to the newest of them.
    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    const asks = relay.reqFilters();
    expect(asks[asks.length - 1].since).toBe(NOW - 100);
  });

  it("stays put when the walk is truncated", async () => {
    // A relay capping its pages BELOW what we asked for cannot prove it served
    // a whole second, so the pager stops and says so. Advancing over that would
    // bury the chunks it never handed us.
    const nextEpoch = 2n;
    const address = baseRekeyGroupKey(root, communityId, nextEpoch);
    const at = NOW - 100;
    const chunk = (n: number) =>
      rotationWrap({
        address,
        scopeIdHex: ROOT_SCOPE_HEX,
        newEpoch: nextEpoch,
        prevEpoch: 1n,
        prevKey: root,
        blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        chunk: [n, 3],
        createdAt: at,
      });
    relay = await startMockRelay({
      kind: "paged",
      pageLimit: 2,
      events: [await chunk(1), await chunk(2), await chunk(3)],
    });
    pool = new RelayPool();
    _configureRekeyPagingForTests(2);

    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    const asks = relay.reqFilters();
    expect(asks[asks.length - 1].since).toBeUndefined();
  });

  it("stays put when the store refuses the write", async () => {
    // A chunk dropped behind an advanced `since` is never served again, and its
    // rotation then stays incomplete for good — the member never adopts and
    // every message under the new epoch stays undecryptable.
    const nextEpoch = 2n;
    relay = await startMockRelay({
      kind: "paged",
      events: [
        await rotationWrap({
          address: baseRekeyGroupKey(root, communityId, nextEpoch),
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: nextEpoch,
          prevEpoch: 1n,
          prevKey: root,
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        }),
      ],
    });
    pool = new RelayPool();

    // A closed table is the cheapest real write failure.
    const original = db.concordRumors.bulkPut.bind(db.concordRumors);
    db.concordRumors.bulkPut = (() =>
      Promise.reject(
        new Error("nope"),
      )) as unknown as typeof db.concordRumors.bulkPut;
    try {
      await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    } finally {
      db.concordRumors.bulkPut = original;
    }
    await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool });
    expect(relay.reqFilters()[1].since).toBeUndefined();
  });
});
