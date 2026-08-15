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
import { readAdoption, applyAdoption } from "@/services/concord-adoptions";
import {
  _resetRekeyCursorsForTests,
  watchBaseRekey,
  watchChannelRekeys,
} from "@/services/concord-rekey-watch";
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
});

afterEach(async () => {
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
    expect(result).toEqual({ adopted: true, excluded: false });

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
    ).toEqual({ adopted: false, excluded: false });
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
    expect(result).toEqual({ adopted: false, excluded: true });
    expect((await readAdoption(me, idHex))?.excludedAtEpoch).toBe("2");
  });

  it("does NOT read a rotation that PREDATES our join as a removal", async () => {
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

    expect(
      await watchBaseRekey(community(), folded(), viewer, JOINED_MS, { pool }),
    ).toEqual({ adopted: false, excluded: false });
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
    ).toEqual({ adopted: false, excluded: false });
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
