/**
 * The roster composition — the wiring between the control fold, the coalesced
 * Guestbook, and the observed authors.
 *
 * The pure halves are pinned in `guestbook.test.ts`. What is proved here is
 * that they are handed the right things: the KICK gate resolved against the
 * folded roster, `banned` applied on both sides, `bannedAt` in seconds, and the
 * observed half read out of the store by the two chat kinds and no others.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { bytesToHex, guestbookGroupKey, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import {
  KIND_COMMENT,
  KIND_JOIN_LEAVE,
  KIND_KICK,
  KIND_MESSAGE,
  KIND_REACTION,
  KIND_SEAL_ENCRYPTED,
} from "@/lib/concord/kinds";
import { Permissions } from "@/lib/concord/roles";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { Community } from "@/lib/concord/types";
import {
  readGuestbookFeed,
  readStoredRoster,
  rosterParticipants,
} from "@/services/concord-members";
import {
  observedAuthors,
  writeChatRumors,
  writeOpened,
} from "@/services/concord-rumor-store";
import { openWrap } from "@/lib/concord/stream";
import { _resetDissolutionForTests } from "@/services/concord-dissolution";
import db from "@/services/db";

/**
 * Record a dissolution the way a real probe would, without one: the service
 * reads its verdict straight out of `concordKv`.
 */
async function rememberDissolvedForTest(id: string, ms: number): Promise<void> {
  await db.concordKv.put({ key: `concord-dissolved:${id}`, value: ms });
}

const root = random32();
const communityId = random32();
const idHex = bytesToHex(communityId);
const gb = guestbookGroupKey(root, communityId, 0n);

const owner = "aa".repeat(32);
const admin = "bb".repeat(32);
const victim = "cc".repeat(32);

function community(): Community {
  return {
    id: communityId,
    idHex,
    owner,
    ownerSalt: random32(),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: [],
    name: "Test",
  };
}

/** A fold with one role granting KICK to `admin`, plus whatever else. */
function folded(over: Partial<FoldedControl> = {}): FoldedControl {
  return {
    roster: {
      roles: [
        {
          roleId: "r1",
          name: "Mods",
          position: 1,
          permissions: Permissions.KICK,
          scope: { kind: "server" as const },
          color: 0,
        },
      ],
      grants: [{ member: admin, roleIds: ["r1"] }],
    },
    ownerHex: owner,
    channels: new Map(),
    banned: new Set(),
    bannedAt: new Map(),
    heads: new Map(),
    incomplete: [],
    ...over,
  } as FoldedControl;
}

/** Store one guestbook rumor the way an ingest would. */
async function storeGuestbook(
  kind: number,
  content: string,
  tags: string[][],
  authorSk: Uint8Array,
  ms: number,
): Promise<void> {
  const pubkey = getPublicKey(authorSk);
  const rumor = buildRumor({ kind, content, tags, pubkey, ms });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, gb, {
    signEvent: async (t) => finalizeEvent(t, authorSk),
  });
  const opened = openWrap(wrapSeal(seal, gb), gb);
  const written = await writeOpened(idHex, [opened], "guestbook");
  expect(written.ok).toBe(true);
}

/** A secret key whose pubkey is a given hex — impossible, so map the other way. */
function keyFor(): { sk: Uint8Array; pk: string } {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

beforeEach(async () => {
  await db.concordRumors.clear();
});

afterEach(async () => {
  await db.concordRumors.clear();
});

describe("readStoredRoster", () => {
  it("honors a kick only from an actor the FOLD says may kick", async () => {
    const target = keyFor();
    const rando = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], target.sk, 1000);
    await storeGuestbook(KIND_KICK, "", [["p", target.pk]], rando.sk, 2000);

    // `rando` holds no role: the kick is not honored and the join stands.
    const unauthorized = await readStoredRoster(community(), folded());
    expect(unauthorized.members.has(target.pk)).toBe(true);

    // Granting the same npub KICK is still not enough: CORD-04 §5 requires the
    // kick to CITE the Grant it acts under, so a client one sweep behind never
    // honors an already-demoted admin. This kick carries no `vac`.
    const withRole = folded({
      roster: {
        roles: [
          {
            roleId: "r1",
            name: "Mods",
            position: 1,
            permissions: Permissions.KICK,
            scope: { kind: "server" as const },
            color: 0,
          },
        ],
        grants: [{ member: rando.pk, roleIds: ["r1"] }],
      },
    });
    const uncited = await readStoredRoster(community(), withRole);
    expect(uncited.coalesced.get(target.pk)?.state).toBe("join");

    // The OWNER is proven by the community_id itself, so no Grant exists to
    // cite and the same stored kick lands. That is what proves the gate reads
    // this fold rather than a constant.
    const asOwner = await readStoredRoster(
      community(),
      folded({ ownerHex: rando.pk }),
    );
    expect(asOwner.coalesced.get(target.pk)?.state).toBe("kick");
    expect(asOwner.members.has(target.pk)).toBe(false);
  });

  it("drops a banned npub from the coalesce AND from the memberlist", async () => {
    const banned = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], banned.sk, 1000);

    const clean = await readStoredRoster(community(), folded());
    expect(clean.members.has(banned.pk)).toBe(true);

    const withBan = await readStoredRoster(
      community(),
      folded({ banned: new Set([banned.pk]) }),
    );
    expect(withBan.coalesced.has(banned.pk)).toBe(false);
    expect(withBan.members.has(banned.pk)).toBe(false);
  });

  it("reads `bannedAt` in SECONDS — a Join before an unbanned member's ban is stale", async () => {
    const member = keyFor();
    // Joined at 1000ms; the control plane recorded the ban at 2 SECONDS.
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], member.sk, 1000);

    // Currently unbanned, but the Join predates the ban → no phantom member.
    const suppressed = await readStoredRoster(
      community(),
      folded({ bannedAt: new Map([[member.pk, 2]]) }),
    );
    expect(suppressed.members.has(member.pk)).toBe(false);

    // The same number read as MILLISECONDS would put the ban at 2ms, before
    // the join, and the member would stand.
    const rejoined = await readStoredRoster(
      community(),
      folded({ bannedAt: new Map([[member.pk, 0]]) }),
    );
    expect(rejoined.members.has(member.pk)).toBe(true);
  });

  it("merges the observed authors, so one message is a membership", async () => {
    // The whole reason grimoire publishes no Join (CORD-02 §5).
    const speaker = keyFor();
    await writeChatRumors(idHex, [
      {
        rumorId: "11".repeat(32),
        author: speaker.pk,
        kind: KIND_MESSAGE,
        content: "hello",
        tags: [],
        ms: 5000,
        createdAt: 5,
        channel: "dd".repeat(32),
      },
    ]);

    const roster = await readStoredRoster(community(), folded());
    expect(roster.members.has(speaker.pk)).toBe(true);
    // …and never from the Guestbook, which has nothing about them.
    expect(roster.coalesced.has(speaker.pk)).toBe(false);
  });
});

describe("the dissolution gate on kicks", () => {
  it("refuses a kick published AFTER the tombstone, and honors one before", async () => {
    // Death wins every race (CORD-02 §9) — but as an ORDERING rule, because
    // the coalesce replays history. A blanket refusal would un-kick everyone
    // the community ever kicked, the moment it died.
    const target = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], target.sk, 1000);
    const kicker = keyFor();
    await storeGuestbook(KIND_KICK, "", [["p", target.pk]], kicker.sk, 5000);
    const asOwner = folded({ ownerHex: kicker.pk });

    // No tombstone: the kick lands.
    expect(
      (await readStoredRoster(community(), asOwner)).coalesced.get(target.pk)
        ?.state,
    ).toBe("kick");

    // Dissolved BEFORE the kick → the kick is refused.
    await rememberDissolvedForTest(idHex, 4000);
    expect(
      (await readStoredRoster(community(), asOwner)).coalesced.get(target.pk)
        ?.state,
    ).toBe("join");

    // Dissolved AFTER it → the kick stands, because it predates the grave.
    await _resetDissolutionForTests();
    await rememberDissolvedForTest(idHex, 6000);
    expect(
      (await readStoredRoster(community(), asOwner)).coalesced.get(target.pk)
        ?.state,
    ).toBe("kick");
    await _resetDissolutionForTests();
  });
});

describe("rosterParticipants", () => {
  it("labels a holder of ONE management bit a moderator", async () => {
    // The bug this pins: permission checks are all-bits, so testing against the
    // management MASK labels a real moderator "member" unless they hold every
    // admin bit at once — which is essentially every real community.
    const mod = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], mod.sk, 1000);
    const fold = folded({
      roster: {
        roles: [
          {
            roleId: "r1",
            name: "Mods",
            position: 1,
            permissions: Permissions.KICK,
            scope: { kind: "server" as const },
            color: 0,
          },
        ],
        grants: [{ member: mod.pk, roleIds: ["r1"] }],
      },
    });

    const participants = rosterParticipants(
      await readStoredRoster(community(), fold),
      fold,
    );
    expect(participants.find((p) => p.pubkey === mod.pk)?.role).toBe(
      "moderator",
    );
    // MANAGE_ROLES is the tier above — shaping the roster itself.
    expect(participants[0]).toEqual({ pubkey: owner, role: "admin" });
  });

  it("narrows a PRIVATE channel to whoever holds its key", async () => {
    // A private channel's audience is its granted role-holders (CORD-03), so
    // listing every member implies an audience the room does not have.
    const insider = keyFor();
    const outsider = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], insider.sk, 1000);
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], outsider.sk, 1000);
    const channelIdHex = "77".repeat(32);
    const fold = folded({
      roster: {
        roles: [
          {
            roleId: "testers",
            name: "Testers",
            position: 1,
            permissions: Permissions.KICK,
            scope: { kind: "channel" as const, channelId: channelIdHex },
            color: 0,
          },
        ],
        grants: [{ member: insider.pk, roleIds: ["testers"] }],
      },
    });
    const roster = await readStoredRoster(community(), fold);

    const priv = rosterParticipants(roster, fold, {
      idHex: channelIdHex,
      isPrivate: true,
    }).map((p) => p.pubkey);
    expect(priv).toContain(insider.pk);
    expect(priv).not.toContain(outsider.pk);
    // The owner is always entitled — position 0, supreme.
    expect(priv).toContain(owner);

    // …and a PUBLIC channel is the whole community again.
    const pub = rosterParticipants(roster, fold, {
      idHex: channelIdHex,
      isPrivate: false,
    }).map((p) => p.pubkey);
    expect(pub).toContain(outsider.pk);
  });

  it("labels a roleless member a member, and never repeats the owner", async () => {
    const plain = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], plain.sk, 1000);
    const fold = folded({ ownerHex: plain.pk });
    const participants = rosterParticipants(
      await readStoredRoster(community(), fold),
      fold,
    );
    expect(participants).toEqual([{ pubkey: plain.pk, role: "admin" }]);
  });
});

describe("observedAuthors", () => {
  const write = (author: string, kind: number, ms: number, id: string) =>
    writeChatRumors(idHex, [
      {
        rumorId: id,
        author,
        kind,
        content: "x",
        tags: [["ms", String(ms % 1000)]],
        ms,
        createdAt: Math.floor(ms / 1000),
        channel: "dd".repeat(32),
      },
    ]);

  it("keeps the NEWEST ms per author", async () => {
    await write(victim, KIND_MESSAGE, 1000, "01".repeat(32));
    await write(victim, KIND_MESSAGE, 9000, "02".repeat(32));
    await write(victim, KIND_MESSAGE, 4000, "03".repeat(32));
    expect((await observedAuthors(idHex)).get(victim)).toBe(9000);
  });

  it("counts messages and comments, and NOTHING else", async () => {
    // A reaction is a weaker signal than a message: admitting it would put a
    // departed member back on the roster for reacting once.
    await write(admin, KIND_COMMENT, 3000, "04".repeat(32));
    await write(victim, KIND_REACTION, 8000, "05".repeat(32));
    const seen = await observedAuthors(idHex);
    expect(seen.get(admin)).toBe(3000);
    expect(seen.has(victim)).toBe(false);
  });

  it("never crosses the community boundary", async () => {
    await write(admin, KIND_MESSAGE, 3000, "06".repeat(32));
    expect((await observedAuthors("ee".repeat(32))).size).toBe(0);
  });
});

describe("readGuestbookFeed", () => {
  it("keeps every entry rather than a final state, newest first", async () => {
    const member = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], member.sk, 1000);
    await storeGuestbook(KIND_JOIN_LEAVE, "leave", [], member.sk, 2000);

    const feed = await readGuestbookFeed(community(), folded());
    expect(feed.map((e) => e.kind)).toEqual(["leave", "join"]);
  });

  it("applies the dissolution ordering rule to a kick", async () => {
    // Death wins every race, but as an ORDERING rule: a kick published before
    // the tombstone still happened, and one published after it never did.
    const early = keyFor();
    const late = keyFor();
    const kicker = keyFor();
    await storeGuestbook(KIND_JOIN_LEAVE, "join", [], early.sk, 500);
    await storeGuestbook(KIND_KICK, "", [["p", early.pk]], kicker.sk, 1000);
    await storeGuestbook(KIND_KICK, "", [["p", late.pk]], kicker.sk, 9000);
    await _resetDissolutionForTests();
    await rememberDissolvedForTest(idHex, 5000);

    // The owner's kicks need no citation, which is what isolates the ordering.
    const feed = await readGuestbookFeed(
      community(),
      folded({ ownerHex: kicker.pk }),
    );
    expect(feed.filter((e) => e.kind === "kick").map((e) => e.pubkey)).toEqual([
      early.pk,
    ]);
    await _resetDissolutionForTests();
  });

  it("gives a row to a member who is banned NOW", async () => {
    const gone = keyFor();
    const feed = await readGuestbookFeed(
      community(),
      folded({
        banned: new Set([gone.pk]),
        bannedAt: new Map([[gone.pk, 4_000]]),
      }),
    );
    // `bannedAt` is seconds; the feed is milliseconds.
    expect(feed).toEqual([
      expect.objectContaining({ kind: "ban", pubkey: gone.pk, ms: 4_000_000 }),
    ]);
  });

  it("gives no row to a member who was banned and since unbanned", async () => {
    // `bannedAt` keeps an entry for every npub a Banlist ever named, so reading
    // it alone would announce bans that have been lifted.
    const forgiven = keyFor();
    const feed = await readGuestbookFeed(
      community(),
      folded({ banned: new Set(), bannedAt: new Map([[forgiven.pk, 4_000]]) }),
    );
    expect(feed).toEqual([]);
  });

  it("gives no row to a banned member the fold has no time for", async () => {
    // Nothing to date the row with, and inventing one would be worse than the
    // roster already saying they are gone.
    const gone = keyFor();
    const feed = await readGuestbookFeed(
      community(),
      folded({ banned: new Set([gone.pk]), bannedAt: new Map() }),
    );
    expect(feed).toEqual([]);
  });
});
