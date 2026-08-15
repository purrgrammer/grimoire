/**
 * The seam between a local adoption and the Community List.
 *
 * Grimoire never publishes kind 13302, so an adoption cannot go where armada
 * puts it. These are the four cases that decide whether the local copy leads,
 * follows, or should be thrown away.
 */

import { describe, expect, it } from "vitest";

import { bytesToHex, random32 } from "@/lib/concord/derive";
import type { Community } from "@/lib/concord/types";
import { applyAdoption } from "@/services/concord-adoptions";
import type { ConcordAdoptionRow } from "@/services/db";

const communityId = random32();
const idHex = bytesToHex(communityId);
const root = random32();
const channelId = random32();
const channelKey = random32();
const rotator = "aa".repeat(32);

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
    relays: [],
    name: "Test",
    ...over,
  };
}

function row(over: Partial<ConcordAdoptionRow> = {}): ConcordAdoptionRow {
  return {
    pubkey: "bb".repeat(32),
    idHex,
    roots: [],
    channels: [],
    cuts: [],
    updatedAt: 0,
    ...over,
  };
}

describe("applyAdoption — roots", () => {
  it("leads when the adoption is ahead of the list", () => {
    const newRoot = random32();
    const { community: out, spent } = applyAdoption(
      community(),
      row({
        roots: [
          {
            epoch: "2",
            key: bytesToHex(newRoot),
            controlPk: "cc".repeat(32),
            refounder: rotator,
            retiredAt: 1700,
          },
        ],
      }),
    );
    expect(spent).toBe(false);
    expect(out.rootEpoch).toBe(2n);
    expect(bytesToHex(out.root)).toBe(bytesToHex(newRoot));
    expect(out.controlPk).toBe("cc".repeat(32));
    expect(out.refounder).toBe(rotator);
    // The epoch it stepped off stays held, with the rotation's publish time as
    // its hard read cutoff.
    expect(out.heldRoots.find((r) => r.epoch === 1n)?.retiredAt).toBe(1700);
  });

  it("is SPENT once the list has caught up with the same key", () => {
    // Armada published the same adoption. Leaving the row would let it shadow a
    // newer list forever.
    const { spent } = applyAdoption(
      community(),
      row({ roots: [{ epoch: "1", key: bytesToHex(root) }] }),
    );
    expect(spent).toBe(true);
  });

  it("is SPENT when the list has moved past it", () => {
    const { community: out, spent } = applyAdoption(
      community({ rootEpoch: 3n }),
      row({ roots: [{ epoch: "2", key: bytesToHex(random32()) }] }),
    );
    expect(spent).toBe(true);
    expect(out.rootEpoch).toBe(3n);
  });

  it("converges a same-epoch race DOWN, keeping both keys held", () => {
    // CORD-06 §3: among authorized candidates at one continuity point the
    // lexicographically lowest new key wins, and both forks stay readable so
    // messages sent into the loser are not lost.
    const low = new Uint8Array(32).fill(0x01);
    const high = new Uint8Array(32).fill(0x02);

    const adoptedLower = applyAdoption(
      community({ root: high, heldRoots: [{ epoch: 1n, key: high }] }),
      row({ roots: [{ epoch: "1", key: bytesToHex(low) }] }),
    );
    expect(bytesToHex(adoptedLower.community.root)).toBe(bytesToHex(low));
    expect(adoptedLower.spent).toBe(false);

    const adoptedHigher = applyAdoption(
      community({ root: low, heldRoots: [{ epoch: 1n, key: low }] }),
      row({ roots: [{ epoch: "1", key: bytesToHex(high) }] }),
    );
    expect(bytesToHex(adoptedHigher.community.root)).toBe(bytesToHex(low));
    // Both keys held either way.
    for (const result of [adoptedLower, adoptedHigher]) {
      const held = result.community.heldRoots
        .filter((r) => r.epoch === 1n)
        .map((r) => bytesToHex(r.key))
        .sort();
      expect(held).toEqual([bytesToHex(low), bytesToHex(high)].sort());
    }
  });

  it("keeps the WINNER's control pair through a same-epoch race", () => {
    // The pair is minted beside the root it ships with (CORD-06 §1), so only
    // the winner's belongs to this epoch. Pinning the loser's `control_pk` onto
    // the winning HeldRoot makes the client register and sweep the losing
    // fork's Control Plane and never the winner's — no roster, no banlist, no
    // channel updates — and `refounder` is the epoch's snapshot authority, so
    // real snapshots get refused too.
    const low = new Uint8Array(32).fill(0x01);
    const high = new Uint8Array(32).fill(0x02);
    const listPk = "cc".repeat(32);
    const adoptedPk = "dd".repeat(32);
    const listRefounder = "11".repeat(32);
    const adoptedRefounder = "22".repeat(32);

    // The LIST holds the winner: its pair must survive untouched.
    const listWins = applyAdoption(
      community({
        root: low,
        controlPk: listPk,
        refounder: listRefounder,
        heldRoots: [
          {
            epoch: 1n,
            key: low,
            controlPk: listPk,
            refounder: listRefounder,
          },
        ],
      }),
      row({
        roots: [
          {
            epoch: "1",
            key: bytesToHex(high),
            controlPk: adoptedPk,
            refounder: adoptedRefounder,
          },
        ],
      }),
    ).community;
    expect(listWins.controlPk).toBe(listPk);
    const winner = listWins.heldRoots.find(
      (r) => bytesToHex(r.key) === bytesToHex(low),
    );
    expect(winner?.controlPk).toBe(listPk);
    expect(winner?.refounder).toBe(listRefounder);
    // The loser is retained as a readable key and nothing more.
    const loser = listWins.heldRoots.find(
      (r) => bytesToHex(r.key) === bytesToHex(high),
    );
    expect(loser?.controlPk).toBeUndefined();

    // The ADOPTION holds the winner: now ITS pair leads, top level included.
    const adoptionWins = applyAdoption(
      community({
        root: high,
        controlPk: listPk,
        refounder: listRefounder,
        heldRoots: [
          {
            epoch: 1n,
            key: high,
            controlPk: listPk,
            refounder: listRefounder,
          },
        ],
      }),
      row({
        roots: [
          {
            epoch: "1",
            key: bytesToHex(low),
            controlPk: adoptedPk,
            refounder: adoptedRefounder,
          },
        ],
      }),
    ).community;
    expect(adoptionWins.controlPk).toBe(adoptedPk);
    expect(adoptionWins.refounder).toBe(adoptedRefounder);
    const won = adoptionWins.heldRoots.find(
      (r) => bytesToHex(r.key) === bytesToHex(low),
    );
    expect(won?.controlPk).toBe(adoptedPk);
    expect(won?.refounder).toBe(adoptedRefounder);
  });

  it("walks several adopted epochs in order", () => {
    const two = random32();
    const three = random32();
    const { community: out } = applyAdoption(
      community(),
      row({
        // Deliberately out of order: the merge sorts them.
        roots: [
          { epoch: "3", key: bytesToHex(three), retiredAt: 300 },
          { epoch: "2", key: bytesToHex(two), retiredAt: 200 },
        ],
      }),
    );
    expect(out.rootEpoch).toBe(3n);
    expect(bytesToHex(out.root)).toBe(bytesToHex(three));
    expect(out.heldRoots.map((r) => Number(r.epoch))).toEqual([3, 2, 1]);
    expect(out.heldRoots.find((r) => r.epoch === 2n)?.retiredAt).toBe(300);
    expect(out.heldRoots.find((r) => r.epoch === 1n)?.retiredAt).toBe(200);
  });

  it("ignores a corrupt key rather than adopting garbage", () => {
    const { community: out } = applyAdoption(
      community(),
      row({ roots: [{ epoch: "2", key: "not-hex" }] }),
    );
    expect(out.rootEpoch).toBe(1n);
  });

  it("never inherits a stale control pair across a rotation", () => {
    // The secret rolls with the root at every Refounding (CORD-02 §2), so a
    // carried-forward pair would subscribe at a dead address. A legacy 72-byte
    // blob leaves both unset and that epoch folds at the legacy address.
    const { community: out } = applyAdoption(
      community({ controlPk: "dd".repeat(32) }),
      row({ roots: [{ epoch: "2", key: bytesToHex(random32()) }] }),
    );
    expect(out.controlPk).toBeUndefined();
  });
});

describe("applyAdoption — what can never be spent", () => {
  it("keeps a row that only records a base exclusion", () => {
    // The base watcher's ONLY output when a Refounding cuts us. Nothing else
    // records it, so deleting it as spent meant it was written and deleted on
    // alternate passes forever and could never be read by anything.
    const { spent } = applyAdoption(community(), row({ excludedAtEpoch: "2" }));
    expect(spent).toBe(false);
  });

  it("keeps a cut for a channel the list no longer vends", () => {
    // A cut is a FLOOR, not a cache: it exists so a stale invite bundle
    // carrying the pre-rotation key can never merge the access back. The
    // channel being absent from the list is the state it describes, not a sign
    // the record is spent.
    const { spent } = applyAdoption(
      community({ privateChannels: [] }),
      row({ cuts: [{ idHex: bytesToHex(channelId), epoch: "2" }] }),
    );
    expect(spent).toBe(false);
  });
});

describe("applyAdoption — channels", () => {
  it("re-keys a channel and retains what it stepped off", () => {
    const next = random32();
    const { community: out } = applyAdoption(
      community(),
      row({
        channels: [
          {
            idHex: bytesToHex(channelId),
            epoch: "2",
            key: bytesToHex(next),
            priors: [
              { epoch: "1", key: bytesToHex(channelKey), retiredAt: 500 },
            ],
          },
        ],
      }),
    );
    const channel = out.privateChannels[0];
    expect(channel.epoch).toBe(2n);
    expect(bytesToHex(channel.key)).toBe(bytesToHex(next));
    expect(bytesToHex(channel.priors![0].key)).toBe(bytesToHex(channelKey));
    expect(channel.priors![0].retiredAt).toBe(500);
  });

  it("drops a channel a rotation cut us out of", () => {
    const { community: out, spent } = applyAdoption(
      community(),
      row({ cuts: [{ idHex: bytesToHex(channelId), epoch: "2" }] }),
    );
    expect(out.privateChannels).toHaveLength(0);
    expect(spent).toBe(false);
  });

  it("does NOT let an old cut filter out a later re-admission", () => {
    // The cut is recorded at the epoch that excluded us. A genuine re-admission
    // arrives above it, and must survive.
    const { community: out } = applyAdoption(
      community({
        privateChannels: [
          { id: channelId, key: channelKey, epoch: 3n, name: "#p" },
        ],
      }),
      row({ cuts: [{ idHex: bytesToHex(channelId), epoch: "2" }] }),
    );
    expect(out.privateChannels).toHaveLength(1);
  });

  it("leaves a channel alone when the list already leads", () => {
    const { community: out, spent } = applyAdoption(
      community({
        privateChannels: [
          { id: channelId, key: channelKey, epoch: 5n, name: "#p" },
        ],
      }),
      row({
        channels: [
          {
            idHex: bytesToHex(channelId),
            epoch: "2",
            key: bytesToHex(random32()),
          },
        ],
      }),
    );
    expect(out.privateChannels[0].epoch).toBe(5n);
    expect(spent).toBe(true);
  });
});
