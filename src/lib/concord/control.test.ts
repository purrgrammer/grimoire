import { beforeEach, describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import {
  banlistLocator,
  bytesToHex,
  communityIdOf,
  grantLocator,
  hex32,
  random32,
} from "./derive";
import { citationToTag, type AuthorityCitation } from "./edition";
import {
  VSK_BANLIST,
  VSK_CHANNEL,
  VSK_GRANT,
  VSK_METADATA,
  VSK_ROLE,
} from "./kinds";
import { Permissions } from "./roles";
import { buildRumor } from "./stream";
import type { OpenedEvent } from "./stream";
import { editionHash } from "./version";
import {
  _resetControlMemosForTests,
  foldControlState,
  openControlEditions,
  type EntityHead,
} from "./control";

const ownerSk = generateSecretKey();
const OWNER = getPublicKey(ownerSk);
const SALT = random32();
const CID = communityIdOf(hex32(OWNER), SALT);

let seq = 0;

/**
 * A control edition as it arrives from the store: an OPENED kind-3308 rumor.
 * The seal signature and rumor-id integrity were proved at ingest, so the fold
 * only ever sees this shape.
 */
function edition(opts: {
  vsk: string;
  entityId: Uint8Array;
  content: unknown;
  author?: string;
  version?: bigint;
  prevHash?: Uint8Array;
  createdAt?: number;
  authority?: AuthorityCitation;
}): OpenedEvent {
  const version = opts.version ?? 1n;
  const author = opts.author ?? OWNER;
  const content = JSON.stringify(opts.content);
  const tags: string[][] = [
    ["vsk", opts.vsk],
    ["eid", bytesToHex(opts.entityId)],
    ["ev", version.toString()],
    ...(opts.prevHash ? [["ep", bytesToHex(opts.prevHash)]] : []),
    ...(opts.authority ? [citationToTag(opts.authority)] : []),
  ];
  const createdAt = opts.createdAt ?? 1_700_000_000 + seq++;
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
    sealKind: 20014,
  };
}

/** The hash the NEXT version of this entity must cite in `ep`. */
function hashOf(
  entityId: Uint8Array,
  version: bigint,
  content: unknown,
  prev?: Uint8Array,
) {
  return editionHash(
    entityId,
    version,
    prev,
    new TextEncoder().encode(JSON.stringify(content)),
  );
}

function fold(
  events: OpenedEvent[],
  priorHeads?: Map<string, EntityHead>,
  snapshotIds?: Set<string>,
) {
  return foldControlState(
    openControlEditions(events),
    CID,
    OWNER,
    priorHeads,
    snapshotIds,
  );
}

beforeEach(() => {
  _resetControlMemosForTests();
});

describe("metadata (vsk 0)", () => {
  it("folds an owner-signed edition at the community's own entity", () => {
    const folded = fold([
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Test", relays: ["wss://a.example"] },
      }),
    ]);
    expect(folded.metadata?.name).toBe("Test");
  });

  it("drops an edition from someone with no authority", () => {
    // The self-promotion defense: an outsider's metadata edition is not
    // "the newest wins", it is not a candidate at all.
    const stranger = getPublicKey(generateSecretKey());
    const folded = fold([
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Hijacked", relays: [] },
        author: stranger,
      }),
    ]);
    expect(folded.metadata).toBeUndefined();
  });

  it("refuses an oversize name — a read-side rule, not mere impoliteness", () => {
    // CORD-02 §6 caps a name at 64 bytes. The cap belongs on the reader too,
    // or one client renders a name every other refuses.
    const folded = fold([
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "x".repeat(65), relays: [] },
      }),
    ]);
    expect(folded.metadata).toBeUndefined();
  });

  it("ignores a vsk-0 edition at any entity other than the community id", () => {
    const folded = fold([
      edition({
        vsk: VSK_METADATA,
        entityId: random32(),
        content: { name: "Spoofed", relays: [] },
      }),
    ]);
    expect(folded.metadata).toBeUndefined();
  });
});

describe("channels (vsk 2)", () => {
  const channelId = random32();

  it("folds a channel definition", () => {
    const folded = fold([
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: { name: "general", private: false },
      }),
    ]);
    const def = folded.channels.get(bytesToHex(channelId))!;
    expect(def.name).toBe("general");
    expect(def.isPrivate).toBe(false);
    expect(def.deleted).toBe(false);
  });

  it("treats deletion as TERMINAL — a later head cannot lift it", () => {
    // CORD-03 §2: the id is never reused, and clients MAY discard the keys.
    // If the head could resurrect a channel, members who honored the discard
    // could never read it again while members who ignored it could — and no
    // rotation heals that split, because every fold agrees it is live.
    const v1 = { name: "general", private: false };
    const v2 = { name: "general", private: false, deleted: true };
    const v3 = { name: "general", private: false, deleted: false };
    const h1 = hashOf(channelId, 1n, v1);
    const h2 = hashOf(channelId, 2n, v2, h1);
    const folded = fold([
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: v1,
        version: 1n,
      }),
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: v2,
        version: 2n,
        prevHash: h1,
      }),
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: v3,
        version: 3n,
        prevHash: h2,
      }),
    ]);
    const def = folded.channels.get(bytesToHex(channelId))!;
    expect(def.deleted).toBe(true);
    expect(def.metadata.deleted).toBe(true);
  });

  it("does NOT let an unauthorized author's tombstone delete a channel", () => {
    // The everDeleted scan is gated by the same predicate the head was picked
    // with — otherwise anyone could erase a channel.
    const stranger = getPublicKey(generateSecretKey());
    const folded = fold([
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: { name: "general", private: false },
      }),
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: { name: "general", private: false, deleted: true },
        author: stranger,
        version: 2n,
      }),
    ]);
    expect(folded.channels.get(bytesToHex(channelId))!.deleted).toBe(false);
  });

  it("refuses a definition with a blank name", () => {
    const folded = fold([
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: { name: "", private: false },
      }),
    ]);
    expect(folded.channels.size).toBe(0);
  });
});

describe("banlist (vsk 4)", () => {
  const banEid = banlistLocator(CID);
  const victim = getPublicKey(generateSecretKey());

  it("folds an owner-signed banlist", () => {
    const folded = fold([
      edition({ vsk: VSK_BANLIST, entityId: banEid, content: [victim] }),
    ]);
    expect(folded.banned.has(victim)).toBe(true);
  });

  it("fails closed on an unauthorized head — the banlist reads EMPTY", () => {
    const stranger = getPublicKey(generateSecretKey());
    const folded = fold([
      edition({
        vsk: VSK_BANLIST,
        entityId: banEid,
        content: [victim],
        author: stranger,
      }),
    ]);
    expect(folded.banned.size).toBe(0);
  });

  it("never bans the OWNER, however authorized the edition", () => {
    // CORD-04 §2: the owner is supreme and unremovable. Since every honest
    // client drops every event from a banned npub (§4), honoring this would
    // let a BAN holder silence the owner in every member's client while the
    // fold still correctly honors their authority.
    const folded = fold([
      edition({ vsk: VSK_BANLIST, entityId: banEid, content: [OWNER, victim] }),
    ]);
    expect(folded.banned.has(OWNER)).toBe(false);
    expect(folded.banned.has(victim)).toBe(true);
    expect(folded.bannedAt.has(OWNER)).toBe(false);
  });

  it("records the newest ban time per npub, for phantom-member suppression", () => {
    const v1 = [victim];
    const h1 = hashOf(banEid, 1n, v1);
    const folded = fold([
      edition({
        vsk: VSK_BANLIST,
        entityId: banEid,
        content: v1,
        version: 1n,
        createdAt: 1_000,
      }),
      edition({
        vsk: VSK_BANLIST,
        entityId: banEid,
        content: [victim],
        version: 2n,
        prevHash: h1,
        createdAt: 2_000,
      }),
    ]);
    expect(folded.bannedAt.get(victim)).toBe(2_000);
  });

  it("drops every edition authored by a banned npub (CORD-04 §4)", () => {
    // Two passes: the first resolves the banlist, the second re-folds with the
    // banned author's editions excluded. Their metadata edition must vanish.
    const rogueSk = generateSecretKey();
    const rogue = getPublicKey(rogueSk);
    const roleId = random32();
    const rid = bytesToHex(roleId);
    const grantEid = grantLocator(CID, hex32(rogue));

    const role = {
      role_id: rid,
      name: "Admin",
      position: 1,
      permissions: Permissions.MANAGE_METADATA.toString(),
    };
    const grant = { member: rogue, role_ids: [rid] };
    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: roleId, content: role }),
      edition({ vsk: VSK_GRANT, entityId: grantEid, content: grant }),
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "By the rogue", relays: [] },
        author: rogue,
        authority: {
          entityId: grantEid,
          version: 1n,
          editionHash: hashOf(grantEid, 1n, grant),
        },
      }),
      edition({
        vsk: VSK_BANLIST,
        entityId: banlistLocator(CID),
        content: [rogue],
      }),
    ]);
    expect(folded.banned.has(rogue)).toBe(true);
    expect(folded.metadata).toBeUndefined();
  });
});

describe("the delegation fixpoint (CORD-04 §2)", () => {
  const roleId = random32();
  const rid = bytesToHex(roleId);
  const member = getPublicKey(generateSecretKey());
  const grantEid = grantLocator(CID, hex32(member));
  const role = {
    role_id: rid,
    name: "Mod",
    position: 5,
    permissions: (
      Permissions.MANAGE_METADATA | Permissions.MANAGE_ROLES
    ).toString(),
  };
  const grant = { member, role_ids: [rid] };

  it("seats an owner-rooted role and grant", () => {
    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: roleId, content: role }),
      edition({ vsk: VSK_GRANT, entityId: grantEid, content: grant }),
    ]);
    expect(folded.roster.roles).toHaveLength(1);
    expect(folded.roster.grants).toHaveLength(1);
  });

  it("drops a SELF-GRANT — an entity never waits on itself for rank", () => {
    // The whole point of the fixpoint: a stranger granting themselves a role
    // has no authority source but the very entity being decided.
    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: roleId, content: role }),
      edition({
        vsk: VSK_GRANT,
        entityId: grantEid,
        content: grant,
        author: member, // granting themselves
      }),
    ]);
    expect(folded.roster.grants).toHaveLength(0);
  });

  it("drops a role minted by someone with no authority", () => {
    const stranger = getPublicKey(generateSecretKey());
    const folded = fold([
      edition({
        vsk: VSK_ROLE,
        entityId: roleId,
        content: role,
        author: stranger,
      }),
    ]);
    expect(folded.roster.roles).toHaveLength(0);
  });

  it("requires the entity coordinate to be the role's own id (anti-spoofing)", () => {
    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: random32(), content: role }),
    ]);
    expect(folded.roster.roles).toHaveLength(0);
  });

  it("requires the grant coordinate to be the member's locator (anti-spoofing)", () => {
    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: roleId, content: role }),
      edition({ vsk: VSK_GRANT, entityId: random32(), content: grant }),
    ]);
    expect(folded.roster.grants).toHaveLength(0);
  });

  it("is a function of the edition SET, not its arrival order", () => {
    const events = [
      edition({ vsk: VSK_ROLE, entityId: roleId, content: role }),
      edition({ vsk: VSK_GRANT, entityId: grantEid, content: grant }),
    ];
    const forward = fold(events);
    _resetControlMemosForTests();
    const reversed = fold([...events].reverse());
    expect(reversed.roster.roles.map((r) => r.roleId)).toEqual(
      forward.roster.roles.map((r) => r.roleId),
    );
    expect(reversed.roster.grants.map((g) => g.member)).toEqual(
      forward.roster.grants.map((g) => g.member),
    );
  });
});

/**
 * The three mechanisms in `authorizeDelegation` that look over-engineered and
 * are not. Each fixture here is built so that REMOVING the mechanism changes the
 * roster — a suite that folds one role plus one grant of different vsks cannot
 * distinguish any of them, because roles always settle before grants and a
 * single-candidate entity has nothing to defer on.
 */
describe("authorizeDelegation's load-bearing mechanisms", () => {
  /** A role whose position and permissions the fixtures vary. */
  const roleAt = (id: Uint8Array, position: number, perms: bigint) => ({
    role_id: bytesToHex(id),
    name: `role-${position}`,
    position,
    permissions: perms.toString(),
  });

  it("the RANKS-FROZEN deferral: a legitimate revoke survives folding out of order", () => {
    // The admin's own Grant must settle before their revoke of the mod can be
    // judged — otherwise the revoke drops as "issued by nobody" and the mod
    // keeps a role an authorized admin took away. Which entity is decided first
    // is eid-sorted, so this is arranged to be the WRONG order: the target's
    // grant sorts before the admin's own.
    // Grant locators are hashes, so the processing order is not ours to choose
    // — it is ground for. Skipping when the order comes out favourable would
    // make this test pass without exercising anything.
    const admin = getPublicKey(generateSecretKey());
    const adminGrantEid = grantLocator(CID, hex32(admin));
    let mod = "";
    let modGrantEid = adminGrantEid;
    for (let i = 0; i < 5000; i++) {
      const candidate = getPublicKey(generateSecretKey());
      const eid = grantLocator(CID, hex32(candidate));
      if (bytesToHex(eid) < bytesToHex(adminGrantEid)) {
        mod = candidate;
        modGrantEid = eid;
        break;
      }
    }
    expect(bytesToHex(modGrantEid) < bytesToHex(adminGrantEid)).toBe(true);

    const adminRoleId = random32();
    const modRoleId = random32();
    const adminRole = roleAt(adminRoleId, 1, Permissions.MANAGE_ROLES);
    const modRole = roleAt(modRoleId, 5, Permissions.MANAGE_MESSAGES);
    const adminGrant = { member: admin, role_ids: [adminRole.role_id] };
    const modGrantV1 = { member: mod, role_ids: [modRole.role_id] };
    const modGrantV2 = { member: mod, role_ids: [] };
    const modV1Hash = hashOf(modGrantEid, 1n, modGrantV1);

    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: adminRoleId, content: adminRole }),
      edition({ vsk: VSK_ROLE, entityId: modRoleId, content: modRole }),
      edition({ vsk: VSK_GRANT, entityId: adminGrantEid, content: adminGrant }),
      edition({ vsk: VSK_GRANT, entityId: modGrantEid, content: modGrantV1 }),
      // The admin revokes, citing their own Grant.
      edition({
        vsk: VSK_GRANT,
        entityId: modGrantEid,
        content: modGrantV2,
        author: admin,
        version: 2n,
        prevHash: modV1Hash,
        authority: {
          entityId: adminGrantEid,
          version: 1n,
          editionHash: hashOf(adminGrantEid, 1n, adminGrant),
        },
      }),
    ]);
    const modGrantSeated = folded.roster.grants.find((g) => g.member === mod);
    expect(modGrantSeated?.roleIds).toEqual([]);
  });

  it("the REPLACE-RANK rule: a low-rank actor cannot revoke a higher-ranked member", () => {
    // Without it a revoke is free to anyone holding MANAGE_ROLES, whatever their
    // position — so the most junior moderator can strip an admin.
    const junior = getPublicKey(generateSecretKey());
    const senior = getPublicKey(generateSecretKey());
    const juniorGrantEid = grantLocator(CID, hex32(junior));
    const seniorGrantEid = grantLocator(CID, hex32(senior));
    const juniorRoleId = random32();
    const seniorRoleId = random32();
    const juniorRole = roleAt(juniorRoleId, 9, Permissions.MANAGE_ROLES);
    const seniorRole = roleAt(seniorRoleId, 1, Permissions.MANAGE_ROLES);
    const juniorGrant = { member: junior, role_ids: [juniorRole.role_id] };
    const seniorGrantV1 = { member: senior, role_ids: [seniorRole.role_id] };
    const seniorGrantV2 = { member: senior, role_ids: [] };

    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: juniorRoleId, content: juniorRole }),
      edition({ vsk: VSK_ROLE, entityId: seniorRoleId, content: seniorRole }),
      edition({
        vsk: VSK_GRANT,
        entityId: juniorGrantEid,
        content: juniorGrant,
      }),
      edition({
        vsk: VSK_GRANT,
        entityId: seniorGrantEid,
        content: seniorGrantV1,
      }),
      edition({
        vsk: VSK_GRANT,
        entityId: seniorGrantEid,
        content: seniorGrantV2,
        author: junior,
        version: 2n,
        prevHash: hashOf(seniorGrantEid, 1n, seniorGrantV1),
        authority: {
          entityId: juniorGrantEid,
          version: 1n,
          editionHash: hashOf(juniorGrantEid, 1n, juniorGrant),
        },
      }),
    ]);
    // The revoke is inadmissible, so the senior keeps their role.
    expect(
      folded.roster.grants.find((g) => g.member === senior)?.roleIds,
    ).toEqual([seniorRole.role_id]);
  });

  it("AUTHORITY-FIRST sibling ordering beats a GROUND rumor id", () => {
    // Equal-version fork siblings are ordered by RANK before the rumor-id
    // tiebreak. The id is grindable and authority is not, so ordering by id
    // alone lets an attacker mine an id that sorts first and have their edition
    // displace their superior's.
    //
    // BOTH siblings must be independently admissible or the ordering decides
    // nothing — so the fork mints a position the junior may genuinely mint
    // (below their own), and the id is ground until it sorts FIRST. That is the
    // attack, executed.
    const junior = getPublicKey(generateSecretKey());
    const juniorGrantEid = grantLocator(CID, hex32(junior));
    const juniorRoleId = random32();
    const targetRoleId = random32();
    const juniorRole = roleAt(juniorRoleId, 9, Permissions.MANAGE_ROLES);
    const juniorGrant = { member: junior, role_ids: [juniorRole.role_id] };
    const juniorCitation = {
      entityId: juniorGrantEid,
      version: 1n,
      editionHash: hashOf(juniorGrantEid, 1n, juniorGrant),
    };

    const ownerVersion = roleAt(targetRoleId, 3, Permissions.MANAGE_MESSAGES);
    const ownerEdition = edition({
      vsk: VSK_ROLE,
      entityId: targetRoleId,
      content: ownerVersion,
    });

    // Grind a nonce until the fork's rumor id sorts BELOW the owner's, so an
    // id-only tiebreak would seat the fork.
    let forkEdition = ownerEdition;
    for (let nonce = 0; nonce < 2000; nonce++) {
      const candidate = edition({
        vsk: VSK_ROLE,
        entityId: targetRoleId,
        // Position 12 is BELOW the junior's own 9, so they may genuinely mint
        // it — which is what makes both siblings admissible and leaves the
        // ordering as the only thing deciding.
        content: { ...roleAt(targetRoleId, 12, 0n), nonce },
        author: junior,
        authority: juniorCitation,
      });
      if (candidate.rumorId < ownerEdition.rumorId) {
        forkEdition = candidate;
        break;
      }
    }
    expect(forkEdition.rumorId < ownerEdition.rumorId).toBe(true);

    const folded = fold([
      edition({ vsk: VSK_ROLE, entityId: juniorRoleId, content: juniorRole }),
      edition({
        vsk: VSK_GRANT,
        entityId: juniorGrantEid,
        content: juniorGrant,
      }),
      ownerEdition,
      forkEdition,
    ]);
    // The owner outranks everyone, so the owner's version wins despite the
    // fork's lower id.
    expect(
      folded.roster.roles.find((r) => r.roleId === bytesToHex(targetRoleId))
        ?.position,
    ).toBe(3);
  });

  it("terminates on a revocation cycle rather than spinning", () => {
    // Two admins each revoking the other, at the same version. The freeze
    // latches are what guarantee this settles at all — and settles the SAME way
    // whichever order the editions arrive in.
    const a = getPublicKey(generateSecretKey());
    const b = getPublicKey(generateSecretKey());
    const aEid = grantLocator(CID, hex32(a));
    const bEid = grantLocator(CID, hex32(b));
    const adminRoleId = random32();
    const adminRole = roleAt(adminRoleId, 1, Permissions.MANAGE_ROLES);
    const aGrant = { member: a, role_ids: [adminRole.role_id] };
    const bGrant = { member: b, role_ids: [adminRole.role_id] };

    const events = [
      edition({ vsk: VSK_ROLE, entityId: adminRoleId, content: adminRole }),
      edition({ vsk: VSK_GRANT, entityId: aEid, content: aGrant }),
      edition({ vsk: VSK_GRANT, entityId: bEid, content: bGrant }),
      edition({
        vsk: VSK_GRANT,
        entityId: aEid,
        content: { member: a, role_ids: [] },
        author: b,
        version: 2n,
        prevHash: hashOf(aEid, 1n, aGrant),
        authority: {
          entityId: bEid,
          version: 1n,
          editionHash: hashOf(bEid, 1n, bGrant),
        },
      }),
      edition({
        vsk: VSK_GRANT,
        entityId: bEid,
        content: { member: b, role_ids: [] },
        author: a,
        version: 2n,
        prevHash: hashOf(bEid, 1n, bGrant),
        authority: {
          entityId: aEid,
          version: 1n,
          editionHash: hashOf(aEid, 1n, aGrant),
        },
      }),
    ];
    const forward = fold(events);
    _resetControlMemosForTests();
    const reversed = fold([...events].reverse());
    const shape = (f: typeof forward) =>
      f.roster.grants
        .map((g) => `${g.member}:${g.roleIds.join(",")}`)
        .sort()
        .join("|");
    expect(shape(reversed)).toBe(shape(forward));
  });
});

describe("the vac authority citation (CORD-04 §5)", () => {
  const roleId = random32();
  const rid = bytesToHex(roleId);
  const admin = getPublicKey(generateSecretKey());
  const grantEid = grantLocator(CID, hex32(admin));
  const role = {
    role_id: rid,
    name: "Admin",
    position: 1,
    permissions: Permissions.MANAGE_METADATA.toString(),
  };
  const grant = { member: admin, role_ids: [rid] };

  const base = () => [
    edition({ vsk: VSK_ROLE, entityId: roleId, content: role }),
    edition({ vsk: VSK_GRANT, entityId: grantEid, content: grant }),
  ];

  it("honors an action citing the actor's own Grant at the folded head", () => {
    const folded = fold([
      ...base(),
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Renamed", relays: [] },
        author: admin,
        authority: {
          entityId: grantEid,
          version: 1n,
          editionHash: hashOf(grantEid, 1n, grant),
        },
      }),
    ]);
    expect(folded.metadata?.name).toBe("Renamed");
  });

  it("refuses a non-owner action carrying NO citation at all", () => {
    const folded = fold([
      ...base(),
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Uncited", relays: [] },
        author: admin,
      }),
    ]);
    expect(folded.metadata).toBeUndefined();
  });

  it("refuses a citation naming a FOREIGN entity", () => {
    // Citing an edition we happen to hold cannot borrow completeness.
    const folded = fold([
      ...base(),
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Borrowed", relays: [] },
        author: admin,
        authority: {
          entityId: random32(),
          version: 1n,
          editionHash: hashOf(grantEid, 1n, grant),
        },
      }),
    ]);
    expect(folded.metadata).toBeUndefined();
  });

  it("refuses a citation whose HASH is not the edition that won our fold", () => {
    // Same version, wrong hash: they cited a non-canonical fork of their own
    // Grant.
    const folded = fold([
      ...base(),
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Forked", relays: [] },
        author: admin,
        authority: {
          entityId: grantEid,
          version: 1n,
          editionHash: random32(),
        },
      }),
    ]);
    expect(folded.metadata).toBeUndefined();
  });

  it("refuses a citation AHEAD of what we hold — fail closed, then self-heal", () => {
    // We are behind: we cannot confirm the authority, so the action parks
    // rather than being honored on the strength of some other grant.
    const folded = fold([
      ...base(),
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Future", relays: [] },
        author: admin,
        authority: {
          entityId: grantEid,
          version: 9n,
          editionHash: hashOf(grantEid, 9n, grant),
        },
      }),
    ]);
    expect(folded.metadata).toBeUndefined();
  });

  it("never asks the OWNER to cite anything", () => {
    // The owner is proven by the community_id itself — no Grant exists to cite.
    const folded = fold([
      edition({
        vsk: VSK_METADATA,
        entityId: CID,
        content: { name: "Owner", relays: [] },
      }),
    ]);
    expect(folded.metadata?.name).toBe("Owner");
  });
});

describe("refuse-downgrade and gap detection (CORD-04 §1)", () => {
  const channelId = random32();
  const v1 = { name: "general", private: false };
  const v2 = { name: "renamed", private: false };
  const h1 = hashOf(channelId, 1n, v1);
  const h2 = hashOf(channelId, 2n, v2, h1);

  it("holds at the floor when the chain to it is withheld", () => {
    // The withheld-middle attack: a relay serves a HIGHER dangling edition and
    // nothing linking to what we already accepted. Adopting it would let the
    // attacker choose our state.
    const priorHeads = new Map<string, EntityHead>([
      [bytesToHex(channelId), { version: 2n, hash: h2 }],
    ]);
    const folded = fold(
      [
        edition({
          vsk: VSK_CHANNEL,
          entityId: channelId,
          content: { name: "attacker", private: false },
          version: 5n,
          prevHash: random32(),
        }),
      ],
      priorHeads,
    );
    expect(folded.channels.size).toBe(0);
    expect(folded.incomplete).toContain(bytesToHex(channelId));
  });

  it("reports a floored entity with ZERO served editions as incomplete", () => {
    const priorHeads = new Map<string, EntityHead>([
      [bytesToHex(channelId), { version: 2n, hash: h2 }],
    ]);
    const folded = fold([], priorHeads);
    expect(folded.incomplete).toContain(bytesToHex(channelId));
  });

  it("does NOT flag an entity that was served but authority-rejected", () => {
    // A deliberate drop, not data loss. Flagging it would false-abort the
    // re-sweep on a plane that is perfectly well served.
    const stranger = getPublicKey(generateSecretKey());
    const folded = fold([
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: v1,
        author: stranger,
      }),
    ]);
    expect(folded.incomplete).toEqual([]);
  });

  it("a fresh joiner with no floor still accepts a dangling head", () => {
    // The legitimate compaction bootstrap: after a Refounding every re-wrapped
    // head has a `prev` naming an edition that no longer exists.
    const folded = fold([
      edition({
        vsk: VSK_CHANNEL,
        entityId: channelId,
        content: v2,
        version: 7n,
        prevHash: random32(),
      }),
    ]);
    expect(folded.channels.get(bytesToHex(channelId))?.name).toBe("renamed");
  });
});
