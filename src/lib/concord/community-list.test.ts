import { describe, expect, it } from "vitest";

import {
  bytesToHex,
  communityIdOf,
  controlSignerGroupKey,
  hex32,
  random32,
} from "./derive";
import {
  applyChannelCuts,
  heldChannelKeys,
  isExcluded,
  isLive,
  liveEntries,
  canonical32,
  mergeCommunityLists,
  parseCommunityList,
  rehydrateCommunity,
  type CommunityList,
  type CommunityListEntry,
  type JoinMaterial,
} from "./community-list";

/** Join material whose id genuinely commits to its owner (CORD-02 §1). */
function makeJoinMaterial(
  overrides: Partial<JoinMaterial> = {},
): JoinMaterial & { community_id: string } {
  const owner = bytesToHex(random32());
  const salt = random32();
  return {
    community_id: bytesToHex(communityIdOf(hex32(owner), salt)),
    owner,
    owner_salt: bytesToHex(salt),
    community_root: bytesToHex(random32()),
    root_epoch: 0,
    channels: [],
    relays: ["wss://a.example"],
    name: "Test",
    ...overrides,
  };
}

function entryOf(
  jm: JoinMaterial & { community_id: string },
  over: Partial<CommunityListEntry> = {},
): CommunityListEntry {
  return {
    community_id: jm.community_id,
    seed: jm,
    current: jm,
    added_at: 1000,
    ...over,
  };
}

const chan = (id: string, epoch: number, key = "1".repeat(64)) => ({
  id,
  key,
  epoch,
  name: "c",
});

describe("parseCommunityList", () => {
  it("tolerates a document missing either array", () => {
    // Written by other clients and other versions: the two arrays are the only
    // things this reader may assume.
    expect(parseCommunityList("{}")).toEqual({ entries: [], tombstones: [] });
    expect(parseCommunityList('{"entries":"nope"}').entries).toEqual([]);
  });

  it("preserves unknown top-level fields", () => {
    const parsed = parseCommunityList('{"entries":[],"tombstones":[],"v":7}');
    expect((parsed as Record<string, unknown>).v).toBe(7);
  });
});

describe("liveness (CORD-02 §8: derived, never deletion)", () => {
  const jm = makeJoinMaterial();
  const withTomb = (removedAt: number): CommunityList => ({
    entries: [entryOf(jm, { added_at: 1000 })],
    tombstones: [{ community_id: jm.community_id, removed_at: removedAt }],
  });

  it("an entry with no tombstone is live", () => {
    expect(
      isLive({ entries: [entryOf(jm)], tombstones: [] }, jm.community_id),
    ).toBe(true);
  });

  it("a newer tombstone kills the entry, an older one does not", () => {
    expect(isLive(withTomb(2000), jm.community_id)).toBe(false);
    expect(isLive(withTomb(500), jm.community_id)).toBe(true);
  });

  it("a tombstone with no entry is not live", () => {
    expect(
      isLive(
        { entries: [], tombstones: [{ community_id: "aa", removed_at: 1 }] },
        "aa",
      ),
    ).toBe(false);
  });

  it("liveEntries drops exactly the dead ones", () => {
    expect(liveEntries(withTomb(2000))).toEqual([]);
    expect(liveEntries(withTomb(500))).toHaveLength(1);
  });
});

describe("exclusion (a kick is read-only, not gone)", () => {
  const jm = makeJoinMaterial({ root_epoch: 3 });

  it("bites only while the marked epoch is BEYOND what we hold", () => {
    expect(isExcluded(entryOf(jm, { excluded_at_epoch: 4 }))).toBe(true);
    // Holding the marked epoch's own root IS re-inclusion, however it arrived.
    expect(isExcluded(entryOf(jm, { excluded_at_epoch: 3 }))).toBe(false);
    expect(isExcluded(entryOf(jm, { excluded_at_epoch: 2 }))).toBe(false);
    expect(isExcluded(entryOf(jm))).toBe(false);
  });
});

describe("channel cuts (a revoke is monotonic)", () => {
  it("floors out a key below the cut epoch", () => {
    const cuts = [{ id: "aa".repeat(32), epoch: 2 }];
    expect(applyChannelCuts([chan("aa".repeat(32), 1)], cuts)).toEqual([]);
  });

  it("honors a genuine re-admission at or above the cut", () => {
    const cuts = [{ id: "aa".repeat(32), epoch: 2 }];
    expect(applyChannelCuts([chan("aa".repeat(32), 2)], cuts)).toHaveLength(1);
  });

  it("holds against a differently-cased spelling of the same channel", () => {
    // CORD-01 says hex is lowercase, but this document is written by other
    // clients: a floor that string-compares ids lets an uppercase respelling
    // of the revoked key walk straight past it.
    const cuts = [{ id: "aa".repeat(32), epoch: 2 }];
    expect(applyChannelCuts([chan("AA".repeat(32), 0)], cuts)).toEqual([]);
  });

  it("takes the highest epoch when a channel is cut twice", () => {
    const cuts = [
      { id: "aa".repeat(32), epoch: 2 },
      { id: "AA".repeat(32), epoch: 5 },
    ];
    expect(applyChannelCuts([chan("aa".repeat(32), 3)], cuts)).toEqual([]);
  });

  it("ignores malformed cut records rather than throwing", () => {
    const cuts = [
      { id: 5, epoch: "x" },
    ] as unknown as CommunityListEntry["channel_cuts"];
    expect(applyChannelCuts([chan("aa".repeat(32), 0)], cuts)).toHaveLength(1);
  });

  it("treats an absent channels field as an empty set", () => {
    // Private Channels are optional (CORD-03): a client that vends no keys
    // omits the field entirely, and the type promises an array anyway.
    expect(heldChannelKeys(undefined)).toEqual([]);
    expect(applyChannelCuts(undefined, [{ id: "aa", epoch: 1 }])).toEqual([]);
  });
});

describe("rehydrateCommunity", () => {
  it("verifies the owner commitment and rebuilds the runtime community", () => {
    const jm = makeJoinMaterial({
      root_epoch: 3,
      held_roots: [{ epoch: 1, key: bytesToHex(random32()) }],
      channels: [
        {
          id: bytesToHex(random32()),
          key: bytesToHex(random32()),
          epoch: 1,
          name: "secret",
        },
      ],
    });
    const community = rehydrateCommunity(entryOf(jm))!;
    expect(community.rootEpoch).toBe(3n);
    expect(community.heldRoots.map((r) => Number(r.epoch))).toEqual([3, 1]);
    expect(community.privateChannels).toHaveLength(1);
  });

  it("takes the entry's id when the snapshot omits it", () => {
    // The shape a kind-33302 fragment in the wild actually holds: the id lives
    // on the entry alone, and there is no `seed` at all. Requiring it inside
    // `current` drops every membership in such a document.
    const jm = makeJoinMaterial();
    const { community_id, ...currentWithoutId } = jm;
    const community = rehydrateCommunity({
      community_id,
      current: currentWithoutId,
      added_at: 1000,
    })!;
    expect(community.idHex).toBe(community_id);
  });

  it("still fails closed when neither the entry nor the snapshot names it", () => {
    const jm = makeJoinMaterial();
    const { community_id: _id, ...currentWithoutId } = jm;
    expect(
      rehydrateCommunity({
        current: currentWithoutId,
        added_at: 1000,
      } as unknown as CommunityListEntry),
    ).toBeUndefined();
  });

  it("fails closed on a corrupted owner", () => {
    // The id is self-certifying: a swapped owner is the whole attack.
    const jm = makeJoinMaterial();
    expect(
      rehydrateCommunity(entryOf({ ...jm, owner: bytesToHex(random32()) })),
    ).toBeUndefined();
  });

  it("carries retirement cutoffs on held roots and channel priors", () => {
    const jm = makeJoinMaterial({
      root_epoch: 2,
      held_roots: [
        { epoch: 1, key: bytesToHex(random32()), retired_at: 1_700_000_000 },
        { epoch: 0, key: bytesToHex(random32()) }, // pre-cutoff: stays uncapped
      ],
      channels: [
        {
          id: bytesToHex(random32()),
          key: bytesToHex(random32()),
          epoch: 2,
          name: "secret",
          priors: [
            {
              key: bytesToHex(random32()),
              epoch: 1,
              retired_at: 1_700_000_100,
            },
          ],
        },
      ],
    });
    const c = rehydrateCommunity(entryOf(jm))!;
    expect(c.heldRoots.find((r) => r.epoch === 1n)?.retiredAt).toBe(
      1_700_000_000,
    );
    expect(c.heldRoots.find((r) => r.epoch === 0n)?.retiredAt).toBeUndefined();
    expect(c.privateChannels[0].priors?.[0].retiredAt).toBe(1_700_000_100);
  });

  it("anchors the seed's root when it names an epoch we do not otherwise hold", () => {
    const seed = makeJoinMaterial({ root_epoch: 0 });
    const current = {
      ...seed,
      root_epoch: 4,
      community_root: bytesToHex(random32()),
    };
    const c = rehydrateCommunity(entryOf(current, { seed }))!;
    expect(c.heldRoots.map((r) => Number(r.epoch))).toEqual([4, 0]);
  });

  it("skips malformed held roots, priors and channels without losing the rest", () => {
    const good = bytesToHex(random32());
    const jm = makeJoinMaterial({
      root_epoch: 2,
      held_roots: [
        { epoch: 1, key: "not-hex" },
        { epoch: 0, key: good },
      ],
      channels: [
        { id: "short", key: good, epoch: 1, name: "bad" },
        {
          id: bytesToHex(random32()),
          key: good,
          epoch: 1,
          name: "ok",
          priors: [{ key: "nope", epoch: 0 }],
        },
      ],
    });
    const c = rehydrateCommunity(entryOf(jm))!;
    expect(c.heldRoots.map((r) => Number(r.epoch))).toEqual([2, 0]);
    expect(c.privateChannels).toHaveLength(1);
    expect(c.privateChannels[0].name).toBe("ok");
    expect(c.privateChannels[0].priors).toBeUndefined();
  });

  it("applies the cut floor at READ time", () => {
    // Armada floors inside its list merge, so its stored set is already
    // floored. Grimoire has no merge, so the floor lives here — without it a
    // stale bundle merged by another client hands us a revoked channel key.
    const cut = bytesToHex(random32());
    const kept = bytesToHex(random32());
    const jm = makeJoinMaterial({
      channels: [
        { id: cut, key: bytesToHex(random32()), epoch: 1, name: "revoked" },
        { id: kept, key: bytesToHex(random32()), epoch: 1, name: "mine" },
      ],
    });
    const c = rehydrateCommunity(
      entryOf(jm, { channel_cuts: [{ id: cut, epoch: 5 }] }),
    )!;
    expect(c.privateChannels.map((p) => p.name)).toEqual(["mine"]);
  });

  it("never unions in relays beyond the community's own", () => {
    // App/platform relays store no Concord wraps and answer every plane REQ
    // with an instant empty EOSE, which can win the backfill's page race and
    // starve the real relays (armada issue #19). There is no parameter to
    // pass them through, and this pins that.
    const jm = makeJoinMaterial({ relays: ["wss://a.example"] });
    expect(rehydrateCommunity(entryOf(jm))!.relays).toEqual([
      "wss://a.example",
    ]);
  });

  describe("control_root (staff write secret, CORD-02 §2)", () => {
    /** A community whose `control_root` genuinely derives to its `control_pk`. */
    function staffEntry(over: Partial<JoinMaterial> = {}) {
      const owner = bytesToHex(random32());
      const salt = random32();
      const id = communityIdOf(hex32(owner), salt);
      const controlRoot = random32();
      const epoch = 2n;
      const jm = makeJoinMaterial({
        community_id: bytesToHex(id),
        owner,
        owner_salt: bytesToHex(salt),
        root_epoch: Number(epoch),
        control_pk: controlSignerGroupKey(controlRoot, id, epoch).pk,
        control_root: bytesToHex(controlRoot),
        ...over,
      });
      return { entry: entryOf(jm), controlRoot };
    }

    it("keeps a secret that derives to the held address for THIS epoch", () => {
      const { entry, controlRoot } = staffEntry();
      const c = rehydrateCommunity(entry)!;
      expect(c.controlPk).toBe(entry.current.control_pk);
      expect(c.controlRoot).toEqual(controlRoot);
    });

    it("drops a secret that does not derive to it", () => {
      // Fails closed to a read-only view rather than signing at an address
      // nobody reads.
      const { entry } = staffEntry({ control_root: bytesToHex(random32()) });
      expect(rehydrateCommunity(entry)!.controlRoot).toBeUndefined();
    });

    it("drops it on a LEGACY epoch, which has no address to derive to", () => {
      const { entry } = staffEntry({ control_pk: undefined });
      const c = rehydrateCommunity(entry)!;
      expect(c.controlPk).toBeUndefined();
      expect(c.controlRoot).toBeUndefined();
    });

    it("reads control_pk off retained roots too (a split epoch in history)", () => {
      const jm = makeJoinMaterial({
        root_epoch: 2,
        held_roots: [
          {
            epoch: 1,
            key: bytesToHex(random32()),
            control_pk: "ab".repeat(32),
            refounder: "cd".repeat(32),
          },
        ],
      });
      const held = rehydrateCommunity(entryOf(jm))!.heldRoots.find(
        (r) => r.epoch === 1n,
      )!;
      expect(held.controlPk).toBe("ab".repeat(32));
      expect(held.refounder).toBe("cd".repeat(32));
    });
  });
});

describe("canonical32", () => {
  it("reads both spellings CORD-02 §8 can present, and only those", () => {
    const hex = "ab".repeat(32);
    const b64url = "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s"; // the same 32 bytes
    expect(canonical32(hex)).toBe(hex);
    expect(canonical32(hex.toUpperCase())).toBe(hex);
    expect(canonical32(b64url)).toBe(hex);
    // Neither length, so neither spelling — left alone rather than guessed at.
    expect(canonical32("nope")).toBeUndefined();
    expect(canonical32(42)).toBeUndefined();
  });

  it("normalizes the named fields and leaves unknown ones verbatim", () => {
    const jm = makeJoinMaterial();
    const b64 = (hex: string) =>
      btoa(String.fromCharCode(...hex32(hex)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const list = parseCommunityList(
      JSON.stringify({
        entries: [
          {
            community_id: b64(jm.community_id),
            current: { ...jm, community_root: b64(jm.community_root) },
            added_at: 1,
            // A key this version has never heard of, holding 32 bytes it must
            // NOT decode — §8's round-trip rule outranks the encoding rule.
            future_key: b64(jm.community_root),
          },
        ],
        tombstones: [],
      }),
    );
    expect(list.entries[0].community_id).toBe(jm.community_id);
    expect(list.entries[0].current.community_root).toBe(jm.community_root);
    expect(list.entries[0].future_key).toBe(b64(jm.community_root));
  });
});

describe("mergeCommunityLists", () => {
  it("keeps the higher epoch as current and the lower as seed", () => {
    const jm = makeJoinMaterial();
    const older = { ...jm, root_epoch: 1 };
    const newer = { ...jm, root_epoch: 4 };
    const merged = mergeCommunityLists([
      { entries: [entryOf(older)], tombstones: [] },
      {
        entries: [entryOf(newer, { seed: older, added_at: 2000 })],
        tombstones: [],
      },
    ]);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].current.root_epoch).toBe(4);
    expect(merged.entries[0].seed?.root_epoch).toBe(1);
    expect(merged.entries[0].added_at).toBe(2000);
  });

  it("is commutative and idempotent — a re-read cannot change the answer", () => {
    const a: CommunityList = {
      entries: [entryOf(makeJoinMaterial({ name: "A" }))],
      tombstones: [],
    };
    const b: CommunityList = {
      entries: [entryOf(makeJoinMaterial({ name: "B" }))],
      tombstones: [],
    };
    const names = (list: CommunityList) =>
      list.entries
        .map((e) => e.current.name)
        .sort()
        .join(",");
    expect(names(mergeCommunityLists([a, b]))).toBe("A,B");
    expect(names(mergeCommunityLists([b, a]))).toBe("A,B");
    expect(names(mergeCommunityLists([a, b, a, b]))).toBe("A,B");
  });

  it("keeps the later removal, so a stale fragment cannot revive a leave", () => {
    const jm = makeJoinMaterial();
    const merged = mergeCommunityLists([
      {
        entries: [entryOf(jm, { added_at: 1000 })],
        tombstones: [{ community_id: jm.community_id, removed_at: 500 }],
      },
      {
        entries: [],
        tombstones: [{ community_id: jm.community_id, removed_at: 9000 }],
      },
    ]);
    expect(liveEntries(merged)).toEqual([]);
  });
});

describe("mergeCommunityLists across generations", () => {
  it("lets a fragment beat the retired List at an equal epoch", () => {
    // The legacy event is never rewritten once a writer migrates, so a
    // same-epoch change — a rename, a newly granted channel key — must not be
    // decided by canonical bytes and settle on the stale copy forever.
    const jm = makeJoinMaterial({ name: "Stale", root_epoch: 3 });
    const fresh = {
      ...jm,
      name: "Fresh",
      channels: [chan("aa".repeat(32), 3)],
    };
    const legacy = { entries: [entryOf(jm)], tombstones: [] };
    const fragment = { entries: [entryOf(fresh)], tombstones: [] };
    for (const order of [
      [
        { list: fragment, rank: 0 },
        { list: legacy, rank: 1 },
      ],
      [
        { list: legacy, rank: 1 },
        { list: fragment, rank: 0 },
      ],
    ]) {
      const merged = mergeCommunityLists(order);
      expect(merged.entries[0].current.name).toBe("Fresh");
      expect(merged.entries[0].current.channels).toHaveLength(1);
    }
  });

  it("still lets a higher epoch win whatever generation carries it", () => {
    const jm = makeJoinMaterial({ root_epoch: 1 });
    const rotated = { ...jm, root_epoch: 5, name: "Rotated" };
    const merged = mergeCommunityLists([
      { list: { entries: [entryOf(jm)], tombstones: [] }, rank: 0 },
      { list: { entries: [entryOf(rotated)], tombstones: [] }, rank: 1 },
    ]);
    expect(merged.entries[0].current.root_epoch).toBe(5);
  });
});

describe("mergeCommunityLists and shapes it does not know", () => {
  it("keeps an entry whose snapshot this build cannot read", () => {
    // The merge feeds a WRITER: dropping an unreadable entry would delete that
    // membership — and the only copy of its channel keys — on every device.
    const jm = makeJoinMaterial();
    const alien = { community_id: "cd".repeat(32), added_at: 7, mystery: true };
    const merged = mergeCommunityLists([
      { entries: [alien as unknown as CommunityListEntry], tombstones: [] },
      { entries: [entryOf(jm)], tombstones: [] },
    ]);
    expect(merged.entries).toHaveLength(2);
    expect(
      merged.entries.find((e) => e.community_id === alien.community_id),
    ).toMatchObject({ mystery: true });
  });
});

describe("mergeCommunityLists and key material", () => {
  const withChannels = (
    jm: JoinMaterial & { community_id: string },
    channels: JoinMaterial["channels"],
    epoch = 0,
  ) => entryOf({ ...jm, root_epoch: epoch, channels });

  it("keeps a seed the other generation carries when a fragment has none", () => {
    // A fragment written without `seed` must not delete the one the retired
    // single-event List still holds: it anchors the earliest epoch this member
    // ever held, which is what a full backfill walks from.
    const jm = makeJoinMaterial();
    const { community_id, ...currentWithoutId } = jm;
    const merged = mergeCommunityLists([
      {
        entries: [{ community_id, current: currentWithoutId, added_at: 1000 }],
        tombstones: [],
      },
      { entries: [entryOf(jm)], tombstones: [] },
    ]);
    expect(merged.entries[0].seed).toEqual(jm);
  });

  it("unions private channel keys instead of picking one snapshot", () => {
    // A re-invite granting [A, C] must never delete the B this member already
    // holds: a channel key is material they accumulate, and nothing recovers it.
    const jm = makeJoinMaterial();
    const A = chan("aa".repeat(32), 0);
    const B = chan("bb".repeat(32), 0);
    const C = chan("cc".repeat(32), 0);
    const merged = mergeCommunityLists([
      { entries: [withChannels(jm, [A, B])], tombstones: [] },
      { entries: [withChannels(jm, [A, C])], tombstones: [] },
    ]);
    expect(merged.entries[0].current.channels.map((c) => c.id).sort()).toEqual(
      [A.id, B.id, C.id].sort(),
    );
  });

  it("keeps held keys when a fresher epoch's bundle carries fewer", () => {
    // The stranded-member heal: a bundle at a newer root epoch grants one
    // channel, and the two the member already holds must survive it.
    const jm = makeJoinMaterial();
    const A = chan("aa".repeat(32), 0);
    const B = chan("bb".repeat(32), 0);
    const merged = mergeCommunityLists([
      { entries: [withChannels(jm, [A, B], 1)], tombstones: [] },
      { entries: [withChannels(jm, [A], 2)], tombstones: [] },
    ]);
    expect(merged.entries[0].current.root_epoch).toBe(2);
    expect(merged.entries[0].current.channels).toHaveLength(2);
  });

  it("carries the older key forward as a prior when one rotates", () => {
    const jm = makeJoinMaterial();
    const old = chan("aa".repeat(32), 1, "11".repeat(32));
    const fresh = chan("aa".repeat(32), 2, "22".repeat(32));
    const merged = mergeCommunityLists([
      { entries: [withChannels(jm, [old])], tombstones: [] },
      { entries: [withChannels(jm, [fresh])], tombstones: [] },
    ]);
    const channel = merged.entries[0].current.channels[0];
    expect(channel.epoch).toBe(2);
    expect(channel.priors?.map((p) => p.epoch)).toEqual([1]);
  });

  it("still refuses a key a cut revoked", () => {
    const jm = makeJoinMaterial();
    const revoked = chan("aa".repeat(32), 1);
    const merged = mergeCommunityLists([
      {
        entries: [
          {
            ...withChannels(jm, []),
            channel_cuts: [{ id: revoked.id, epoch: 2 }],
          },
        ],
        tombstones: [],
      },
      { entries: [withChannels(jm, [revoked])], tombstones: [] },
    ]);
    expect(merged.entries[0].current.channels).toEqual([]);
  });
});
