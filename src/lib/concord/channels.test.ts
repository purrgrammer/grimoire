import { describe, expect, it } from "vitest";

import {
  bytesToHex,
  channelGroupKey,
  communityIdOf,
  hex32,
  random32,
} from "./derive";
import {
  channelCategory,
  channelPosition,
  channelsView,
  compareChannelOrder,
  groupChannelsByCategory,
  partitionPinned,
  resolveOpenChannel,
} from "./channels";
import type { FoldedChannel, FoldedControl } from "./control";
import { emptyRoles } from "./roles";
import type { ChannelMetadata, Community } from "./types";

const owner = bytesToHex(random32());
const salt = random32();
const id = communityIdOf(hex32(owner), salt);
const root = random32();

function community(over: Partial<Community> = {}): Community {
  return {
    id,
    idHex: bytesToHex(id),
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

function folded(channels: FoldedChannel[]): FoldedControl {
  return {
    roster: emptyRoles(),
    ownerHex: owner,
    channels: new Map(channels.map((c) => [c.channelIdHex, c])),
    banned: new Set(),
    bannedAt: new Map(),
    heads: new Map(),
    incomplete: [],
  };
}

function channelDef(
  name: string,
  over: Partial<FoldedChannel> & { metadata?: ChannelMetadata } = {},
): FoldedChannel {
  const idHex = over.channelIdHex ?? bytesToHex(random32());
  return {
    channelIdHex: idHex,
    name,
    isPrivate: false,
    deleted: false,
    metadata: { name, private: false },
    ...over,
  };
}

describe("armada.order", () => {
  it("reads a position off custom", () => {
    expect(
      channelPosition({
        name: "a",
        private: false,
        custom: { "armada.order": { position: 3 } },
      }),
    ).toBe(3);
  });

  it("ignores a malformed or negative position rather than the channel", () => {
    // Advisory display data: a bad value loses the arrangement, never a channel.
    for (const position of [-1, 1.5, "3", null, undefined]) {
      expect(
        channelPosition({
          name: "a",
          private: false,
          custom: { "armada.order": { position } },
        }),
      ).toBeUndefined();
    }
    expect(channelPosition({ name: "a", private: false })).toBeUndefined();
  });

  it("sorts positioned channels first, then the rest by name", () => {
    const rows = [
      { name: "zulu", position: 0 },
      { name: "alpha" },
      { name: "bravo" },
      { name: "yankee", position: 1 },
    ];
    expect([...rows].sort(compareChannelOrder).map((r) => r.name)).toEqual([
      "zulu",
      "yankee",
      "alpha",
      "bravo",
    ]);
  });
});

describe("armada.category", () => {
  it("reads a trimmed name off custom", () => {
    expect(
      channelCategory({
        name: "a",
        private: false,
        custom: { "armada.category": { name: "  Voice  " } },
      }),
    ).toBe("Voice");
  });

  it("reads blank or oversize as uncategorized, not as invalid", () => {
    for (const name of ["", "   ", "x".repeat(65)]) {
      expect(
        channelCategory({
          name: "a",
          private: false,
          custom: { "armada.category": { name } },
        }),
      ).toBeUndefined();
    }
  });

  it("folds two spellings into ONE group, deterministically", () => {
    const rows = [
      { name: "a", category: "Voice" },
      { name: "b", category: "voice" },
    ];
    const { categories } = groupChannelsByCategory(rows, (r) => r.category);
    expect(categories).toHaveLength(1);
    // The displayed spelling comes from the first channel of the group, so the
    // heading is chosen by order rather than by whichever the fold yielded.
    expect(categories[0].name).toBe("Voice");
    expect(categories[0].channels).toHaveLength(2);
  });

  it("puts the uncategorized run first and orders categories by their leader", () => {
    const rows = [
      { name: "readme", category: undefined },
      { name: "b", category: "Second" },
      { name: "a", category: "First" },
      { name: "c", category: "Second" },
    ];
    const { uncategorized, categories } = groupChannelsByCategory(
      rows,
      (r) => r.category,
    );
    expect(uncategorized.map((r) => r.name)).toEqual(["readme"]);
    expect(categories.map((c) => c.name)).toEqual(["Second", "First"]);
  });

  it("cannot produce an empty category", () => {
    // Emergent, not an entity: nothing to garbage-collect, and no way to show a
    // heading whose channels are all hidden.
    const { categories } = groupChannelsByCategory([], () => "Ghost");
    expect(categories).toEqual([]);
  });
});

describe("channelsView", () => {
  it("derives a public channel's stream from the community root per held epoch", () => {
    const c = community({
      rootEpoch: 1n,
      heldRoots: [
        { epoch: 1n, key: root },
        { epoch: 0n, key: random32(), retiredAt: 1_700_000_000 },
      ],
    });
    const def = channelDef("general");
    const [channel] = channelsView(c, folded([def]));
    expect(channel.streams.map((s) => Number(s.epoch))).toEqual([1, 0]);
    expect(channel.current.group.pk).toBe(
      channelGroupKey(root, hex32(def.channelIdHex), 1n).pk,
    );
    // The retired epoch carries its cutoff, so the decode path can refuse
    // anything sealed under it with a later created_at.
    expect(channel.streams[1].retiredAt).toBe(1_700_000_000);
  });

  it("omits a PRIVATE channel whose key we do not hold", () => {
    // Its ciphertext is unreadable anyway — omit rather than tease.
    const def = channelDef("secret", { isPrivate: true });
    expect(channelsView(community(), folded([def]))).toEqual([]);
  });

  it("reads a held private channel from its own key and every retained prior", () => {
    const channelId = random32();
    const idHex = bytesToHex(channelId);
    const currentKey = random32();
    const priorKey = random32();
    const c = community({
      privateChannels: [
        {
          id: channelId,
          key: currentKey,
          epoch: 2n,
          name: "secret",
          priors: [{ key: priorKey, epoch: 1n, retiredAt: 1_700_000_000 }],
        },
      ],
    });
    const def = channelDef("secret", { channelIdHex: idHex, isPrivate: true });
    const [channel] = channelsView(c, folded([def]));
    expect(channel.streams.map((s) => Number(s.epoch))).toEqual([2, 1]);
    expect(channel.streams[1].group.pk).toBe(
      channelGroupKey(priorKey, channelId, 1n).pk,
    );
    // NOT the root-derived stream: those messages are world-readable to the
    // whole membership, and surfacing them here would present public content
    // as private.
    const rootPk = channelGroupKey(root, channelId, 0n).pk;
    expect(channel.streams.some((s) => s.group.pk === rootPk)).toBe(false);
  });

  it("drops a deleted channel from display", () => {
    const def = channelDef("gone", { deleted: true });
    expect(channelsView(community(), folded([def]))).toEqual([]);
  });

  it("a deleted PRIVATE channel is not resurrected by the held-key fallback", () => {
    // The fallback exists so a fresh join renders before the fold lands. It
    // must not undo a tombstone the fold already delivered.
    const channelId = random32();
    const idHex = bytesToHex(channelId);
    const c = community({
      privateChannels: [
        { id: channelId, key: random32(), epoch: 1n, name: "secret" },
      ],
    });
    const def = channelDef("secret", {
      channelIdHex: idHex,
      isPrivate: true,
      deleted: true,
    });
    expect(channelsView(c, folded([def]))).toEqual([]);
  });

  it("renders a held private channel the fold has not delivered yet", () => {
    const channelId = random32();
    const c = community({
      privateChannels: [
        { id: channelId, key: random32(), epoch: 1n, name: "secret" },
      ],
    });
    const [channel] = channelsView(c, folded([]));
    expect(channel.name).toBe("secret");
    expect(channel.isPrivate).toBe(true);
  });

  it("returns the sidebar already in display order", () => {
    const positioned = channelDef("zulu", {
      metadata: {
        name: "zulu",
        private: false,
        custom: { "armada.order": { position: 0 } },
      },
    });
    const view = channelsView(
      community(),
      folded([channelDef("alpha"), positioned]),
    );
    expect(view.map((c) => c.name)).toEqual(["zulu", "alpha"]);
    expect(view[0].position).toBe(0);
  });

  it("renders nothing when there is no fold and no held key", () => {
    expect(channelsView(community(), undefined)).toEqual([]);
  });
});

describe("resolveOpenChannel", () => {
  const chans = [{ idHex: "aa" }, { idHex: "bb" }, { idHex: "cc" }];

  it("prefers what the reader just clicked", () => {
    expect(resolveOpenChannel(chans, "cc", "bb")?.idHex).toBe("cc");
  });

  it("falls back to what this device was last left on", () => {
    expect(resolveOpenChannel(chans, undefined, "bb")?.idHex).toBe("bb");
  });

  it("falls back to the first readable channel when neither resolves", () => {
    // A remembered channel can name one that was deleted, or one whose key the
    // member no longer holds — the sidebar must still fill.
    expect(resolveOpenChannel(chans, "zz", "yy")?.idHex).toBe("aa");
    expect(resolveOpenChannel(chans, undefined, undefined)?.idHex).toBe("aa");
  });

  it("matches regardless of how the id was cased on the way in", () => {
    expect(resolveOpenChannel(chans, "CC")?.idHex).toBe("cc");
  });

  it("has nothing to open before the fold lands", () => {
    expect(resolveOpenChannel([], "aa", "bb")).toBeUndefined();
  });
});

describe("partitionPinned", () => {
  const chans = [
    { idHex: "aa", name: "alpha" },
    { idHex: "bb", name: "beta" },
    { idHex: "cc", name: "gamma" },
  ];

  it("keeps display order inside both runs", () => {
    const { pinned, rest } = partitionPinned(chans, (ch) =>
      ["cc", "aa"].includes(ch.idHex),
    );
    // Pinning does not reorder: the community's own arrangement still decides
    // which pinned channel comes first.
    expect(pinned.map((c) => c.idHex)).toEqual(["aa", "cc"]);
    expect(rest.map((c) => c.idHex)).toEqual(["bb"]);
  });

  it("is the identity when nothing is pinned", () => {
    const { pinned, rest } = partitionPinned(chans, () => false);
    expect(pinned).toEqual([]);
    expect(rest).toEqual(chans);
  });

  it("leaves nothing behind when everything is pinned", () => {
    const { pinned, rest } = partitionPinned(chans, () => true);
    expect(pinned).toEqual(chans);
    expect(rest).toEqual([]);
  });
});
