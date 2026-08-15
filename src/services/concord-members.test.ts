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
  readStoredRoster,
  rosterParticipants,
} from "@/services/concord-members";
import {
  observedAuthors,
  writeChatRumors,
  writeOpened,
} from "@/services/concord-rumor-store";
import { openWrap } from "@/lib/concord/stream";
import db from "@/services/db";

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
          scope: { kind: "global" },
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
            scope: { kind: "global" },
            color: 0,
          },
        ],
        grants: [{ member: rando.pk, roleIds: ["r1"] }],
      },
    } as Partial<FoldedControl>);
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
            scope: { kind: "global" },
            color: 0,
          },
        ],
        grants: [{ member: mod.pk, roleIds: ["r1"] }],
      },
    } as Partial<FoldedControl>);

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
