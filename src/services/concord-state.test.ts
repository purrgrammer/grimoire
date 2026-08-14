import { beforeEach, describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import {
  bytesToHex,
  communityIdOf,
  controlGroupKey,
  grantLocator,
  hex32,
  random32,
} from "@/lib/concord/derive";
import { _resetControlMemosForTests } from "@/lib/concord/control";
import { citationToTag, type AuthorityCitation } from "@/lib/concord/edition";
import { VSK_GRANT, VSK_ROLE } from "@/lib/concord/kinds";
import { Permissions } from "@/lib/concord/roles";
import { buildRumor } from "@/lib/concord/stream";
import type { OpenedWireEvent } from "@/lib/concord/stream";
import type { Community } from "@/lib/concord/types";
import { editionHash } from "@/lib/concord/version";
import db from "@/services/db";
import {
  pruneControlSnapshots,
  readControlSnapshot,
  writeOpened,
} from "@/services/concord-rumor-store";
import { heldControlPlanes } from "@/lib/concord/control-address";

import {
  _resetConcordStateForTests,
  foldStoredControl,
  readStoredState,
} from "./concord-state";

const owner = getPublicKey(generateSecretKey());
const salt = random32();
const cid = communityIdOf(hex32(owner), salt);
const root = random32();

function community(over: Partial<Community> = {}): Community {
  return {
    id: cid,
    idHex: bytesToHex(cid),
    owner,
    ownerSalt: salt,
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: ["wss://a.example"],
    name: "Test",
    ...over,
  };
}

let seq = 0;

/** A stored control edition, as `writeOpened` would have put it there. */
function edition(opts: {
  vsk: string;
  entityId: Uint8Array;
  content: unknown;
  author?: string;
  version?: bigint;
  prevHash?: Uint8Array;
  authority?: AuthorityCitation;
}): OpenedWireEvent {
  const version = opts.version ?? 1n;
  const author = opts.author ?? owner;
  const content = JSON.stringify(opts.content);
  const tags: string[][] = [
    ["vsk", opts.vsk],
    ["eid", bytesToHex(opts.entityId)],
    ["ev", version.toString()],
    ...(opts.prevHash ? [["ep", bytesToHex(opts.prevHash)]] : []),
    ...(opts.authority ? [citationToTag(opts.authority)] : []),
  ];
  const createdAt = 1_700_000_000 + seq++;
  const rumor = buildRumor({
    kind: 3308,
    content,
    tags,
    pubkey: author,
    createdAtSecs: createdAt,
    ms: null,
  });
  return {
    rumorId: rumor.id,
    author,
    kind: rumor.kind,
    content,
    tags,
    createdAt,
    ms: createdAt * 1000,
    wrapId: rumor.id,
    streamPk: "aa".repeat(32),
    sealKind: 20014,
    seal: {} as never,
  };
}

function hashOf(entityId: Uint8Array, version: bigint, content: unknown) {
  return editionHash(
    entityId,
    version,
    undefined,
    new TextEncoder().encode(JSON.stringify(content)),
  );
}

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordSnapshots.clear();
  await db.concordKv.clear();
  _resetConcordStateForTests();
  _resetControlMemosForTests();
});

describe("the carried head floor", () => {
  it("is RAISED, never replaced — a revoked grant cannot come back", async () => {
    // The failure this guards, in order:
    //   1. the owner grants A `Admin` and M `Mod`;
    //   2. A revokes M (grant v2, empty role_ids) — floor for M's grant = v2;
    //   3. the owner then revokes A, so A is unranked;
    //   4. now M's v2 is inadmissible (issued by nobody) and v1 is below-floor,
    //      so M's grant settles NOTHING and drops out of `folded.heads`.
    // Assigning `folded.heads` wholesale would delete M's floor at that point,
    // and the next fold over the SAME editions would re-seat the revoked v1
    // grant — CORD-04 §1's stale-Grant replay, performed by our own store.
    const admin = getPublicKey(generateSecretKey());
    const mod = getPublicKey(generateSecretKey());
    const adminEid = grantLocator(cid, hex32(admin));
    const modEid = grantLocator(cid, hex32(mod));
    const adminRoleId = random32();
    const modRoleId = random32();
    const adminRole = {
      role_id: bytesToHex(adminRoleId),
      name: "Admin",
      position: 1,
      permissions: Permissions.MANAGE_ROLES.toString(),
    };
    const modRole = {
      role_id: bytesToHex(modRoleId),
      name: "Mod",
      position: 5,
      permissions: Permissions.MANAGE_MESSAGES.toString(),
    };
    const adminGrantV1 = { member: admin, role_ids: [adminRole.role_id] };
    const modGrantV1 = { member: mod, role_ids: [modRole.role_id] };

    const c = community();
    await writeOpened(
      c.idHex,
      [
        edition({ vsk: VSK_ROLE, entityId: adminRoleId, content: adminRole }),
        edition({ vsk: VSK_ROLE, entityId: modRoleId, content: modRole }),
        edition({ vsk: VSK_GRANT, entityId: adminEid, content: adminGrantV1 }),
        edition({ vsk: VSK_GRANT, entityId: modEid, content: modGrantV1 }),
        // A revokes M, citing their own Grant.
        edition({
          vsk: VSK_GRANT,
          entityId: modEid,
          content: { member: mod, role_ids: [] },
          author: admin,
          version: 2n,
          prevHash: hashOf(modEid, 1n, modGrantV1),
          authority: {
            entityId: adminEid,
            version: 1n,
            editionHash: hashOf(adminEid, 1n, adminGrantV1),
          },
        }),
      ],
      "control",
      { refounded: false },
    );

    const first = await foldStoredControl(c);
    expect(first!.roster.grants.find((g) => g.member === mod)?.roleIds).toEqual(
      [],
    );

    // The owner now revokes A.
    _resetControlMemosForTests();
    await writeOpened(
      c.idHex,
      [
        edition({
          vsk: VSK_GRANT,
          entityId: adminEid,
          content: { member: admin, role_ids: [] },
          version: 2n,
          prevHash: hashOf(adminEid, 1n, adminGrantV1),
        }),
      ],
      "control",
      { refounded: false },
    );

    // Two more folds over the same durable set. M's grant must stay revoked in
    // both: the floor remembers v2 even though nothing settled it this round.
    for (const _pass of [1, 2]) {
      _resetControlMemosForTests();
      const again = await foldStoredControl(c);
      expect(
        again!.roster.grants.find((g) => g.member === mod)?.roleIds ?? [],
      ).toEqual([]);
    }
  });

  it("re-baselines on a Refounding rather than out-anchoring the new epoch", async () => {
    // The floor is keyed by epoch. A Refounding legitimately drops entities, so
    // a floor that never forgets would report them `incomplete` forever and
    // re-arm a full sweep every cycle.
    const channelId = random32();
    const meta = { name: "general", private: false };
    const c0 = community({ rootEpoch: 0n });
    await writeOpened(
      c0.idHex,
      [edition({ vsk: "2", entityId: channelId, content: meta, version: 4n })],
      "control",
      { refounded: false },
    );
    const before = await foldStoredControl(c0);
    expect(before!.heads.size).toBe(1);

    // Same community, new epoch — with a snapshot recorded at the address the
    // fold will actually ask about, so it runs rather than waiting.
    const newRoot = random32();
    const c1 = community({
      rootEpoch: 1n,
      root: newRoot,
      heldRoots: [
        { epoch: 1n, key: newRoot },
        { epoch: 0n, key: root },
      ],
    });
    await db.concordSnapshots.put({
      communityId: c1.idHex,
      controlPk: controlGroupKey(newRoot, cid, 1n).pk,
      rumorIds: ["deadbeef"],
      updatedAt: Date.now(),
    });
    _resetControlMemosForTests();
    const after = await foldStoredControl(c1);
    // No floor carried across the epoch, so nothing reports unaccounted-for.
    expect(after!.incomplete).toEqual([]);
  });
});

describe("the materialized fold", () => {
  it("is served on the next read without replaying the editions", async () => {
    const c = community();
    await writeOpened(
      c.idHex,
      [
        edition({
          vsk: "2",
          entityId: random32(),
          content: { name: "general", private: false },
        }),
      ],
      "control",
      { refounded: false },
    );

    const first = await readStoredState(c);
    expect(first!.channels.map((ch) => ch.name)).toEqual(["general"]);

    // Drop the editions entirely. A read that still answers proves it came from
    // the materialized fold rather than from replaying what is on disk.
    await db.concordRumors.clear();
    _resetControlMemosForTests();
    const second = await readStoredState(c);
    expect(second!.channels.map((ch) => ch.name)).toEqual(["general"]);
  });

  it("is not served across a Refounding", async () => {
    // A rotation replaces the authoritative edition set, so a fold from the
    // superseded founding must never answer for the new epoch.
    const c0 = community({ rootEpoch: 0n });
    await writeOpened(
      c0.idHex,
      [
        edition({
          vsk: "2",
          entityId: random32(),
          content: { name: "general", private: false },
        }),
      ],
      "control",
      { refounded: false },
    );
    expect((await readStoredState(c0))!.channels).toHaveLength(1);

    const newRoot = random32();
    const c1 = community({
      rootEpoch: 1n,
      root: newRoot,
      heldRoots: [{ epoch: 1n, key: newRoot }],
    });
    // No snapshot recorded for the new epoch yet, so this must WAIT rather than
    // hand back the old epoch's cached fold.
    expect(await readStoredState(c1)).toBeUndefined();
  });

  it("rejects a snapshot whose shape this build cannot read", async () => {
    // Dexie rehydrates behind an unchecked cast, so a fold written by an older
    // build arrives typed as current. A miss costs one re-fold; a wrong read
    // throws on first dereference.
    const c = community();
    await db.concordKv.put({
      key: `concordFold:${c.idHex}@0`,
      value: { ownerHex: owner, channels: new Map() },
    });
    await writeOpened(
      c.idHex,
      [
        edition({
          vsk: "2",
          entityId: random32(),
          content: { name: "recovered", private: false },
        }),
      ],
      "control",
      { refounded: false },
    );
    expect((await readStoredState(c))!.channels.map((ch) => ch.name)).toEqual([
      "recovered",
    ]);
  });
});

describe("snapshot pruning", () => {
  it("keeps a LEGACY epoch's DERIVED control address", async () => {
    // The bug this guards destroyed data, and only on a legacy Refounded
    // community: `control_pk` is absent there because the address is derived
    // rather than handed over (CORD-02 §2), so pruning by that field produced an
    // empty keep-set and deleted the snapshot the sweep had just written. The
    // community then never folded again — the gate blocked on a set wiped as
    // fast as it was written, and the channel list stayed empty forever.
    const c = community({
      rootEpoch: 2n,
      heldRoots: [
        { epoch: 2n, key: root },
        { epoch: 1n, key: random32() },
      ],
    });
    const current = controlGroupKey(root, cid, 2n).pk;
    const stale = controlGroupKey(random32(), cid, 9n).pk;
    for (const controlPk of [current, stale]) {
      await db.concordSnapshots.put({
        communityId: c.idHex,
        controlPk,
        rumorIds: ["a"],
        updatedAt: Date.now(),
      });
    }

    await pruneControlSnapshots(
      c.idHex,
      heldControlPlanes(c).map((held) => held.group.pk),
    );

    expect(await readControlSnapshot(c.idHex, current)).toBeDefined();
    expect(await readControlSnapshot(c.idHex, stale)).toBeUndefined();

    // And the shape that caused it: reading `controlPk` off the held roots of a
    // legacy community yields nothing to keep, so everything goes.
    expect(
      c.heldRoots
        .map((held) => held.controlPk)
        .filter((pk): pk is string => pk !== undefined),
    ).toEqual([]);
  });
});

describe("a Refounded community waits for its compaction snapshot", () => {
  it("refuses to fold by old-root contiguity before the snapshot lands", async () => {
    // Folding early anchors on a superseded old-epoch fragment and seats it in
    // preference to the compacted head — stale metadata, a stale banlist, a
    // revoked grant. The two orders disagree about which editions outrank which,
    // so there is no safe first answer.
    const c = community({ rootEpoch: 3n });
    await writeOpened(
      c.idHex,
      [
        edition({
          vsk: "2",
          entityId: random32(),
          content: { name: "general", private: false },
        }),
      ],
      "control",
      { refounded: false },
    );
    expect(await foldStoredControl(c)).toBeUndefined();
  });

  it("folds a community that has never Refounded immediately", async () => {
    const c = community({ rootEpoch: 0n });
    await writeOpened(
      c.idHex,
      [
        edition({
          vsk: "2",
          entityId: random32(),
          content: { name: "general", private: false },
        }),
      ],
      "control",
      { refounded: false },
    );
    expect(await foldStoredControl(c)).toBeDefined();
  });
});
