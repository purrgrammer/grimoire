import { describe, expect, it } from "vitest";

import { buildWireSpec, type WireInputs } from "./wire-spec";
import { KIND_WRAP } from "./kinds";
import type { GroupKey, StreamKeyView } from "./derive";
import type { Channel } from "./types";

const RELAY = "wss://relay.example.com/";
const OTHER = "wss://other.example.com/";

const pk = (seed: string) => seed.repeat(64).slice(0, 64);

function groupKey(seed: string): GroupKey {
  return {
    sk: new Uint8Array(32),
    pk: pk(seed),
    convKey: new Uint8Array(32),
  } as GroupKey;
}

function streamView(seed: string): StreamKeyView {
  return { pk: pk(seed), convKey: new Uint8Array(32) };
}

/** A channel with a current epoch and, optionally, retired priors. */
function channel(
  idSeed: string,
  currentSeed: string,
  priorSeeds: string[] = [],
): Channel {
  const current = { epoch: 2n, group: groupKey(currentSeed) };
  return {
    id: new Uint8Array(32),
    idHex: pk(idSeed),
    name: `#${idSeed}`,
    isPrivate: false,
    streams: [
      current,
      ...priorSeeds.map((seed, i) => ({
        epoch: BigInt(1 - i),
        group: groupKey(seed),
        retiredAt: 1_700_000_000,
      })),
    ],
    current,
  };
}

const COMMUNITY = pk("c");

function inputs(over: Partial<WireInputs> = {}): WireInputs {
  return { channels: [], control: [], ...over };
}

/** The authors of the one filter on a relay, or undefined if there is none. */
function authorsAt(
  spec: ReturnType<typeof buildWireSpec>,
  relay: string,
): string[][] {
  const sub = spec.subs.find((s) => s.relay === relay);
  return (sub?.filters ?? []).map((f) => f.authors ?? []);
}

describe("buildWireSpec — chat", () => {
  it("subscribes to the CURRENT epoch only, but can decode every held one", () => {
    // Armada's reason, and the one thing here that is a security property
    // rather than a bandwidth one: a retired epoch is sealed history with a
    // hard read cutoff, so nothing legitimate arrives there live — and holding
    // the address open forever is a standing writable side-channel for anyone
    // ever ejected from that epoch.
    const ch = channel("a", "1", ["2", "3"]);
    const spec = buildWireSpec(
      inputs({
        channels: [{ relays: [RELAY], channel: ch, communityIdHex: COMMUNITY }],
      }),
    );

    expect(authorsAt(spec, RELAY)).toEqual([[pk("1")]]);
    // The decode map is deliberately wider: a wrap already in flight when the
    // rotation landed, or one drained from the park, still opens.
    expect([...spec.channelByPk.keys()].sort()).toEqual(
      [pk("1"), pk("2"), pk("3")].sort(),
    );
  });

  it("merges every channel on a relay into ONE filter", () => {
    const spec = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
          {
            relays: [RELAY],
            channel: channel("b", "2"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );

    // A REQ per channel would be a REQ per channel per relay. Communities share
    // relays, so the author list is one flat set.
    expect(authorsAt(spec, RELAY)).toEqual([[pk("1"), pk("2")].sort()]);
  });

  it("routes a channel to each of its relays", () => {
    const spec = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [RELAY, OTHER],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    expect(spec.subs.map((s) => s.relay)).toEqual([RELAY, OTHER].sort());
  });

  it("remembers which community owns each channel", () => {
    // Without this a rumor has no honest tenant to be filed under, and guessing
    // would put one community's messages in another's store.
    const spec = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    expect(spec.communityByChannel.get(pk("a"))).toBe(COMMUNITY);
  });
});

describe("buildWireSpec — control", () => {
  it("subscribes to the current plane and decodes every held epoch", () => {
    const spec = buildWireSpec(
      inputs({
        control: [
          {
            relays: [RELAY],
            idHex: COMMUNITY,
            current: streamView("4"),
            groups: [streamView("4"), streamView("5")],
            refounded: true,
          },
        ],
      }),
    );

    expect(authorsAt(spec, RELAY)).toEqual([[pk("4")]]);
    expect([...spec.controlByPk.keys()].sort()).toEqual(
      [pk("4"), pk("5")].sort(),
    );
    expect(spec.controlByPk.get(pk("5"))).toMatchObject({
      idHex: COMMUNITY,
      refounded: true,
    });
  });

  it("registers the current address even when the held set omits it", () => {
    // A live edition with nothing to decode it is the same as no subscription.
    const spec = buildWireSpec(
      inputs({
        control: [
          {
            relays: [RELAY],
            idHex: COMMUNITY,
            current: streamView("4"),
            groups: [],
            refounded: false,
          },
        ],
      }),
    );
    expect(spec.controlByPk.has(pk("4"))).toBe(true);
  });

  it("keeps the control filter separate from the chat filter", () => {
    // They decode with different keys and wake different things. Merging them
    // would make the demux guess.
    const spec = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
        ],
        control: [
          {
            relays: [RELAY],
            idHex: COMMUNITY,
            current: streamView("4"),
            groups: [streamView("4")],
            refounded: false,
          },
        ],
      }),
    );
    expect(authorsAt(spec, RELAY)).toEqual([[pk("1")], [pk("4")]]);
    expect(spec.subs[0].filters.every((f) => f.kinds?.[0] === KIND_WRAP)).toBe(
      true,
    );
  });
});

describe("buildWireSpec — the signature", () => {
  it("is stable across input order", () => {
    // The per-relay diff restarts a round when its signature changes, and the
    // inputs settle several times during startup. An unstable signature would
    // tear down live subscriptions for no change at all.
    const a = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
          {
            relays: [OTHER],
            channel: channel("b", "2"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    const b = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [OTHER],
            channel: channel("b", "2"),
            communityIdHex: COMMUNITY,
          },
          {
            relays: [RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    expect(a.sig).toBe(b.sig);
  });

  it("changes when a channel is added", () => {
    const before = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    const after = buildWireSpec(
      inputs({
        channels: [
          {
            relays: [RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
          {
            relays: [RELAY],
            channel: channel("b", "2"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    expect(after.sig).not.toBe(before.sig);
  });
});

describe("buildWireSpec — relay hygiene", () => {
  it("drops a relay URL it cannot normalize", () => {
    const spec = buildWireSpec(
      inputs({
        channels: [
          {
            relays: ["   ", RELAY],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    expect(spec.subs.map((s) => s.relay)).toEqual([RELAY]);
  });

  it("treats two spellings of one relay as one subscription", () => {
    const spec = buildWireSpec(
      inputs({
        channels: [
          {
            relays: ["wss://relay.example.com", "wss://relay.example.com/"],
            channel: channel("a", "1"),
            communityIdHex: COMMUNITY,
          },
        ],
      }),
    );
    expect(spec.subs).toHaveLength(1);
    expect(authorsAt(spec, RELAY)).toEqual([[pk("1")]]);
  });

  it("produces nothing at all with no inputs", () => {
    const spec = buildWireSpec(inputs());
    expect(spec.subs).toEqual([]);
    expect(spec.sig).toBe("[]");
  });
});
