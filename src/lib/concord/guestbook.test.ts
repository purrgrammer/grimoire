import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type EventTemplate,
  type NostrEvent,
} from "nostr-tools";
import { describe, expect, it } from "vitest";

import { bytesToHex, guestbookGroupKey, random32 } from "@/lib/concord/derive";
import {
  coalesceGuestbook,
  completeMemberlist,
  guestbookFeed,
  snapshotAuthorities,
} from "@/lib/concord/guestbook";
import {
  KIND_JOIN_LEAVE,
  KIND_KICK,
  KIND_SEAL_ENCRYPTED,
  KIND_SNAPSHOT,
} from "@/lib/concord/kinds";
import {
  buildRumor,
  openWrap,
  sealRumor,
  wrapSeal,
  type OpenedEvent,
} from "@/lib/concord/stream";
import type { Community } from "@/lib/concord/types";

// Ported from armada `bc19d1f` (`src/concord/lib/guestbook.test.ts`). The
// BUILDERS live here rather than in the module: grimoire publishes no Join, no
// Leave, no Kick and no snapshot, so they are test fixtures, not shipped code.

function signer(sk = generateSecretKey()) {
  return {
    sk,
    pubkey: getPublicKey(sk),
    signEvent: async (t: EventTemplate) => finalizeEvent(t, sk),
  };
}

const root = new Uint8Array(32).fill(6);
const cid = new Uint8Array(32).fill(7);
const gb = guestbookGroupKey(root, cid, 0);

/** Snapshot chunk size: 400 members per event (CORD-02 §5). */
const SNAPSHOT_CHUNK = 400;

function joinRumor(
  pubkey: string,
  ms: number,
  attribution?: { creator: string; label?: string },
) {
  const tags: string[][] = [];
  if (attribution)
    tags.push(["invite", attribution.creator, attribution.label ?? ""]);
  return buildRumor({
    kind: KIND_JOIN_LEAVE,
    content: "join",
    tags,
    pubkey,
    ms,
  });
}

function leaveRumor(pubkey: string, ms: number) {
  return buildRumor({
    kind: KIND_JOIN_LEAVE,
    content: "leave",
    tags: [],
    pubkey,
    ms,
  });
}

function kickRumor(
  adminPubkey: string,
  targetHex: string,
  ms: number,
  vac?: { eid: string; version: bigint; hash: string },
) {
  const tags: string[][] = [["p", targetHex]];
  if (vac) tags.push(["vac", vac.eid, vac.version.toString(), vac.hash]);
  return buildRumor({
    kind: KIND_KICK,
    content: "",
    tags,
    pubkey: adminPubkey,
    ms,
  });
}

function snapshotRumors(
  refounderPubkey: string,
  members: string[],
  snapshotIdHex: string,
  ms: number,
) {
  const chunks: string[][] = [];
  for (let i = 0; i < members.length; i += SNAPSHOT_CHUNK) {
    chunks.push(members.slice(i, i + SNAPSHOT_CHUNK));
  }
  if (chunks.length === 0) chunks.push([]);
  const n = chunks.length;
  return chunks.map((chunk, i) =>
    buildRumor({
      kind: KIND_SNAPSHOT,
      content: JSON.stringify(chunk),
      tags: [["snap", snapshotIdHex, (i + 1).toString(), n.toString()]],
      pubkey: refounderPubkey,
      ms,
    }),
  );
}

async function seal(
  rumor: ReturnType<typeof buildRumor>,
  who: ReturnType<typeof signer>,
): Promise<NostrEvent> {
  return wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, gb, who), gb);
}

/** Open every wrap that decodes under the guestbook key. */
function open(wraps: NostrEvent[]): OpenedEvent[] {
  const out: OpenedEvent[] = [];
  for (const wrap of wraps) {
    try {
      out.push(openWrap(wrap, gb));
    } catch {
      // not ours
    }
  }
  return out;
}

const allowAllKicks = () => true;
const denyAllKicks = () => false;

describe("guestbook coalesce (CORD-02 §5)", () => {
  it("one final state per npub — the latest entry wins", async () => {
    const alice = signer();
    const wraps = [
      await seal(joinRumor(alice.pubkey, 1000), alice),
      await seal(leaveRumor(alice.pubkey, 2000), alice),
      await seal(joinRumor(alice.pubkey, 3000), alice),
    ];
    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
    });
    expect(coalesced.get(alice.pubkey)?.state).toBe("join");
    expect(coalesced.get(alice.pubkey)?.ms).toBe(3000);
  });

  it("drops every entry from a banned npub — join and kick alike (CORD-04 §4)", async () => {
    const banned = signer();
    const victim = signer();
    const wraps = [
      await seal(joinRumor(banned.pubkey, 1000), banned),
      await seal(kickRumor(banned.pubkey, victim.pubkey, 2000), banned),
      await seal(joinRumor(victim.pubkey, 1500), victim),
    ];
    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: allowAllKicks,
      banned: new Set([banned.pubkey]),
    });
    expect(coalesced.has(banned.pubkey)).toBe(false);
    // The banned member's kick never landed.
    expect(coalesced.get(victim.pubkey)?.state).toBe("join");
  });

  it("drops entries dated more than one hour ahead of the local clock", async () => {
    const alice = signer();
    const now = 1_000_000_000_000;
    const wraps = [
      await seal(joinRumor(alice.pubkey, now), alice),
      await seal(leaveRumor(alice.pubkey, now + 2 * 60 * 60 * 1000), alice),
    ];
    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: now,
      canKick: denyAllKicks,
    });
    expect(coalesced.get(alice.pubkey)?.state).toBe("join");
  });

  it("a kick is honored only from an authorized actor", async () => {
    const alice = signer();
    const admin = signer();
    const rando = signer();
    const wraps = [
      await seal(joinRumor(alice.pubkey, 1000), alice),
      await seal(kickRumor(rando.pubkey, alice.pubkey, 2000), rando),
    ];
    const unauthorized = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: (actor) => actor === admin.pubkey,
    });
    expect(unauthorized.get(alice.pubkey)?.state).toBe("join");

    const kicked = [
      ...wraps,
      await seal(kickRumor(admin.pubkey, alice.pubkey, 3000), admin),
    ];
    const authorized = coalesceGuestbook(open(kicked), {
      nowMs: 10_000,
      canKick: (actor) => actor === admin.pubkey,
    });
    expect(authorized.get(alice.pubkey)?.state).toBe("kick");
  });

  it("passes the kick's `vac` citation through to the gate", async () => {
    // The CORD-04 §5 sync floor is enforced by the CALLER, so the citation has
    // to reach it. Dropping it silently would make every kick from an admin
    // whose demotion we have not read yet land unchecked.
    const alice = signer();
    const admin = signer();
    const vac = { eid: "aa".repeat(32), version: 4n, hash: "bb".repeat(32) };
    const wraps = [
      await seal(kickRumor(admin.pubkey, alice.pubkey, 2000, vac), admin),
    ];
    let seen: string[] | undefined;
    coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: (_actor, _target, citation) => {
        seen = citation
          ? [bytesToHex(citation.entityId), citation.version.toString()]
          : undefined;
        return true;
      },
    });
    expect(seen).toEqual([vac.eid, "4"]);
  });

  it("a snapshot seeds members but any newer self-signed entry supersedes it", async () => {
    const refounder = signer();
    const alice = signer();
    const bob = signer();
    const rumors = snapshotRumors(
      refounder.pubkey,
      [alice.pubkey, bob.pubkey],
      bytesToHex(random32()),
      5000,
    );
    const wraps: NostrEvent[] = [];
    for (const r of rumors) wraps.push(await seal(r, refounder));
    wraps.push(await seal(leaveRumor(bob.pubkey, 6000), bob));

    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
      snapshotAuthorities: new Set([refounder.pubkey]),
    });
    expect(coalesced.get(alice.pubkey)?.state).toBe("join");
    expect(coalesced.get(alice.pubkey)?.fromSnapshot).toBe(true);
    expect(coalesced.get(bob.pubkey)?.state).toBe("leave");
  });

  it("a snapshot from anyone but the epoch's refounder is ignored", async () => {
    const refounder = signer();
    const impostor = signer();
    const alice = signer();
    const rumors = snapshotRumors(
      impostor.pubkey,
      [alice.pubkey],
      bytesToHex(random32()),
      5000,
    );
    const wraps: NostrEvent[] = [];
    for (const r of rumors) wraps.push(await seal(r, impostor));
    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: allowAllKicks,
      snapshotAuthorities: new Set([refounder.pubkey]),
    });
    expect(coalesced.size).toBe(0);
  });

  it("honors a PRIOR epoch's refounder — the sweep spans every held guestbook", async () => {
    const past = signer();
    const current = signer();
    const alice = signer();
    const rumors = snapshotRumors(
      past.pubkey,
      [alice.pubkey],
      bytesToHex(random32()),
      5000,
    );
    const wraps: NostrEvent[] = [];
    for (const r of rumors) wraps.push(await seal(r, past));

    const opened = open(wraps);
    expect(
      coalesceGuestbook(opened, {
        nowMs: 10_000,
        canKick: denyAllKicks,
        snapshotAuthorities: new Set([current.pubkey]),
      }).size,
    ).toBe(0);
    expect(
      coalesceGuestbook(opened, {
        nowMs: 10_000,
        canKick: denyAllKicks,
        snapshotAuthorities: new Set([current.pubkey, past.pubkey]),
      }).get(alice.pubkey)?.state,
    ).toBe("join");
  });

  it("no snapshot authority means NO snapshot is honored — never an owner fallback", async () => {
    const owner = signer();
    const ghost = signer();
    const rumors = snapshotRumors(
      owner.pubkey,
      [ghost.pubkey],
      bytesToHex(random32()),
      5000,
    );
    const wraps: NostrEvent[] = [];
    for (const r of rumors) wraps.push(await seal(r, owner));
    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
      snapshotAuthorities: undefined,
    });
    expect(coalesced.has(ghost.pubkey)).toBe(false);
  });

  it("breaks a same-instant tie on the LOWER rumor id, deterministically", async () => {
    // The cross-client tiebreak: two clients disagreeing here fold different
    // rosters from identical data. Built by hand rather than sealed, so the two
    // ids are known and the assertion cannot come out either way by luck.
    const alice = "aa".repeat(32);
    const entry = (rumorId: string, state: "join" | "leave"): OpenedEvent => ({
      rumorId,
      author: alice,
      kind: KIND_JOIN_LEAVE,
      content: state,
      tags: [],
      ms: 5000,
      createdAt: 5,
    });
    const low = "0".repeat(64);
    const high = "f".repeat(64);

    // Same ms, same firsthand-ness — only the id separates them, and the order
    // they arrive in must not matter.
    for (const opened of [
      [entry(high, "join"), entry(low, "leave")],
      [entry(low, "leave"), entry(high, "join")],
    ]) {
      const coalesced = coalesceGuestbook(opened, {
        nowMs: 10_000,
        canKick: denyAllKicks,
      });
      expect(coalesced.get(alice)?.rumorId).toBe(low);
      expect(coalesced.get(alice)?.state).toBe("leave");
    }
  });

  it("a firsthand entry at the same instant beats a snapshot seed", async () => {
    const refounder = signer();
    const alice = signer();
    const rumors = snapshotRumors(
      refounder.pubkey,
      [alice.pubkey],
      bytesToHex(random32()),
      5000,
    );
    const wraps: NostrEvent[] = [];
    for (const r of rumors) wraps.push(await seal(r, refounder));
    wraps.push(await seal(leaveRumor(alice.pubkey, 5000), alice));

    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
      snapshotAuthorities: new Set([refounder.pubkey]),
    });
    expect(coalesced.get(alice.pubkey)?.state).toBe("leave");
    expect(coalesced.get(alice.pubkey)?.fromSnapshot).toBe(false);

    // …and the same pair with the ids forced the WRONG way for the id
    // tiebreak, so this cannot pass by falling through to it.
    const snapshotEntry: OpenedEvent = {
      rumorId: "0".repeat(64),
      author: refounder.pubkey,
      kind: KIND_SNAPSHOT,
      content: JSON.stringify([alice.pubkey]),
      tags: [["snap", "aa".repeat(32), "1", "1"]],
      ms: 7000,
      createdAt: 7,
    };
    const firsthand: OpenedEvent = {
      rumorId: "f".repeat(64),
      author: alice.pubkey,
      kind: KIND_JOIN_LEAVE,
      content: "leave",
      tags: [],
      ms: 7000,
      createdAt: 7,
    };
    const forced = coalesceGuestbook([snapshotEntry, firsthand], {
      nowMs: 10_000,
      canKick: denyAllKicks,
      snapshotAuthorities: new Set([refounder.pubkey]),
    });
    expect(forced.get(alice.pubkey)?.fromSnapshot).toBe(false);
  });
});

describe("snapshot authorities", () => {
  const community = (over: Partial<Community>): Community =>
    ({
      id: cid,
      idHex: bytesToHex(cid),
      owner: "0".repeat(64),
      ownerSalt: new Uint8Array(32),
      root,
      rootEpoch: 0n,
      heldRoots: [{ epoch: 0n, key: root }],
      privateChannels: [],
      relays: [],
      name: "test",
      ...over,
    }) as Community;

  it("is empty at genesis — epoch 0 has no snapshot to authorize", () => {
    expect(snapshotAuthorities(community({})).size).toBe(0);
  });

  it("collects every held epoch's recorded refounder, plus the current one", () => {
    const past = "a".repeat(64);
    const now = "b".repeat(64);
    const out = snapshotAuthorities(
      community({
        rootEpoch: 2n,
        refounder: now,
        heldRoots: [
          { epoch: 2n, key: root, refounder: now },
          { epoch: 1n, key: root, refounder: past },
          // Genesis contributes nothing even if a refounder is somehow recorded.
          { epoch: 0n, key: root, refounder: "c".repeat(64) },
        ],
      }),
    );
    expect([...out].sort()).toEqual([past, now].sort());
  });

  it("contributes nothing for an epoch whose refounder was never recorded", () => {
    // Accepting NO snapshot is the safe miss; falling back to the owner would
    // let an npub who never minted the epoch seed arbitrary members into it.
    const out = snapshotAuthorities(
      community({ rootEpoch: 1n, heldRoots: [{ epoch: 1n, key: root }] }),
    );
    expect(out.size).toBe(0);
  });
});

describe("complete memberlist", () => {
  it("guestbook ∪ observed − banned, with observation counting only forward", async () => {
    const alice = signer();
    const bob = signer();
    const carol = signer();
    const wraps = [
      await seal(joinRumor(alice.pubkey, 1000), alice),
      await seal(leaveRumor(bob.pubkey, 5000), bob),
    ];
    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
    });

    // Bob's OLD activity (before his leave) can't resurrect him; carol was
    // never in the guestbook but is observably present — and banned.
    const observed = new Map<string, number>([
      [bob.pubkey, 4000],
      [carol.pubkey, 8000],
      [alice.pubkey, 2000],
    ]);
    const members = completeMemberlist(
      coalesced,
      observed,
      new Set([carol.pubkey]),
    );
    expect(members.has(alice.pubkey)).toBe(true);
    expect(members.has(bob.pubkey)).toBe(false);
    expect(members.has(carol.pubkey)).toBe(false);

    // Bob speaks AFTER his leave → observably present again.
    const rejoined = completeMemberlist(
      coalesced,
      new Map([[bob.pubkey, 6000]]),
      new Set(),
    );
    expect(rejoined.has(bob.pubkey)).toBe(true);
  });

  it("a Join predating a ban is not counted after unban; a fresh Join is", async () => {
    const alice = signer();
    const wraps = [await seal(joinRumor(alice.pubkey, 1000), alice)];
    const coalesced = coalesceGuestbook(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
    });
    const bannedAt = new Map([[alice.pubkey, 2]]); // SECONDS

    expect(
      completeMemberlist(coalesced, new Map(), new Set(), bannedAt).has(
        alice.pubkey,
      ),
    ).toBe(false);
    // Without the ban history she counts — proving the gate is what suppresses her.
    expect(
      completeMemberlist(coalesced, new Map(), new Set()).has(alice.pubkey),
    ).toBe(true);

    const withRejoin = [
      ...wraps,
      await seal(joinRumor(alice.pubkey, 3000), alice),
    ];
    const rejoined = coalesceGuestbook(open(withRejoin), {
      nowMs: 10_000,
      canKick: denyAllKicks,
    });
    expect(
      completeMemberlist(rejoined, new Map(), new Set(), bannedAt).has(
        alice.pubkey,
      ),
    ).toBe(true);
  });

  it("observed activity before a ban doesn't re-add; activity after does", () => {
    const alice = signer();
    const bannedAt = new Map([[alice.pubkey, 5]]); // 5s = 5000ms
    const empty = coalesceGuestbook([], {
      nowMs: 10_000,
      canKick: denyAllKicks,
    });

    expect(
      completeMemberlist(
        empty,
        new Map([[alice.pubkey, 4000]]),
        new Set(),
        bannedAt,
      ).has(alice.pubkey),
    ).toBe(false);
    expect(
      completeMemberlist(
        empty,
        new Map([[alice.pubkey, 6000]]),
        new Set(),
        bannedAt,
      ).has(alice.pubkey),
    ).toBe(true);
  });
});

describe("the guestbook as a feed", () => {
  it("keeps every entry an npub made, in order, rather than one state", async () => {
    // The coalesce answers "are they in?"; the feed answers "what happened?" —
    // and a member who joined, left and came back did three things.
    const alice = signer();
    const wraps = [
      await seal(joinRumor(alice.pubkey, 1000), alice),
      await seal(leaveRumor(alice.pubkey, 2000), alice),
      await seal(joinRumor(alice.pubkey, 3000), alice),
    ];
    const feed = guestbookFeed(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
    });
    expect(feed.map((e) => e.kind)).toEqual(["join", "leave", "join"]);
    expect(feed.map((e) => e.ms)).toEqual([3000, 2000, 1000]);
  });

  it("names the moderator on a kick", async () => {
    const admin = signer();
    const victim = signer();
    const feed = guestbookFeed(
      open([await seal(kickRumor(admin.pubkey, victim.pubkey, 2000), admin)]),
      { nowMs: 10_000, canKick: allowAllKicks },
    );
    expect(feed).toEqual([
      expect.objectContaining({
        kind: "kick",
        pubkey: victim.pubkey,
        actor: admin.pubkey,
      }),
    ]);
  });

  it("excludes a kick the actor was not authorized to make", async () => {
    // A feed row is a claim that something happened, and this did not.
    const nobody = signer();
    const victim = signer();
    const feed = guestbookFeed(
      open([await seal(kickRumor(nobody.pubkey, victim.pubkey, 2000), nobody)]),
      { nowMs: 10_000, canKick: denyAllKicks },
    );
    expect(feed).toEqual([]);
  });

  it("excludes everything from a banned author, kicks included", async () => {
    const banned = signer();
    const victim = signer();
    const wraps = [
      await seal(joinRumor(banned.pubkey, 1000), banned),
      await seal(kickRumor(banned.pubkey, victim.pubkey, 2000), banned),
    ];
    const feed = guestbookFeed(open(wraps), {
      nowMs: 10_000,
      canKick: allowAllKicks,
      banned: new Set([banned.pubkey]),
    });
    expect(feed).toEqual([]);
  });

  it("takes no rows from a snapshot", async () => {
    // A snapshot is a secondhand seed; rendering one as "joined" would date a
    // member's arrival to whenever somebody last compacted the plane.
    const refounder = signer();
    const alice = signer();
    const wraps = await Promise.all(
      snapshotRumors(
        refounder.pubkey,
        [alice.pubkey],
        "ab".repeat(32),
        5000,
      ).map((r) => seal(r, refounder)),
    );
    const feed = guestbookFeed(open(wraps), {
      nowMs: 10_000,
      canKick: denyAllKicks,
      snapshotAuthorities: new Set([refounder.pubkey]),
    });
    expect(feed).toEqual([]);
  });

  it("drops an entry dated far in the future", async () => {
    const alice = signer();
    const feed = guestbookFeed(
      open([await seal(joinRumor(alice.pubkey, 10_000_000), alice)]),
      { nowMs: 1000, canKick: denyAllKicks },
    );
    expect(feed).toEqual([]);
  });

  it("carries the invite a join was made with", async () => {
    const alice = signer();
    const host = signer();
    const feed = guestbookFeed(
      open([
        await seal(
          joinRumor(alice.pubkey, 1000, {
            creator: host.pubkey,
            label: "spring",
          }),
          alice,
        ),
      ]),
      { nowMs: 10_000, canKick: denyAllKicks },
    );
    expect(feed[0].invite).toEqual({ creator: host.pubkey, label: "spring" });
  });
});
