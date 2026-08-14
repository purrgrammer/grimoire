import { describe, expect, it } from "vitest";

import {
  ADMIN_ALL,
  badgeOf,
  byDisplayOrder,
  canActOnMember,
  canActOnPosition,
  colorToHex,
  effectivePermissions,
  effectivePermissionsIn,
  emptyRoles,
  grantFromJSON,
  hasPermission,
  highestPosition,
  isAdmin,
  isAuthorized,
  isAuthorizedIn,
  isStaff,
  MANAGEMENT_MASK,
  Permissions,
  permsContain,
  roleFromJSON,
  STAFF_MASK,
  type CommunityRoles,
  type Role,
} from "./roles";

const OWNER = "aa".repeat(32);
const ALICE = "bb".repeat(32);
const BOB = "cc".repeat(32);
const CAROL = "dd".repeat(32);

const roleId = (n: string) => n.repeat(64).slice(0, 64);

function role(over: Partial<Role> & { roleId: string }): Role {
  return {
    name: "role",
    position: 5,
    permissions: 0n,
    scope: { kind: "server" },
    color: 0,
    ...over,
  };
}

function roster(
  roles: Role[],
  grants: CommunityRoles["grants"],
): CommunityRoles {
  return { roles, grants };
}

describe("permission bits (CORD-04 §3, frozen)", () => {
  it("pins each bit to its position", () => {
    // These positions are wire format. A renumbering silently re-reads every
    // existing Role as a different set of powers.
    expect(Permissions.MANAGE_ROLES).toBe(1n);
    expect(Permissions.MANAGE_CHANNELS).toBe(2n);
    expect(Permissions.MANAGE_METADATA).toBe(4n);
    expect(Permissions.KICK).toBe(8n);
    expect(Permissions.BAN).toBe(16n);
    expect(Permissions.MANAGE_MESSAGES).toBe(32n);
    expect(Permissions.CREATE_INVITE).toBe(64n);
    expect(Permissions.VIEW_AUDIT_LOG).toBe(256n);
    expect(Permissions.MENTION_EVERYONE).toBe(512n);
    expect(Permissions.PIN_MESSAGES).toBe(2048n);
  });

  it("burns 1<<7 rather than reusing it", () => {
    // Retired (was MANAGE_INVITES). Nothing may claim it.
    expect(Object.values(Permissions)).not.toContain(128n);
    expect(ADMIN_ALL & 128n).toBe(0n);
  });

  it("has no all-powerful bit", () => {
    // A Role granted everything today must not inherit a permission added
    // tomorrow, so ADMIN_ALL is an explicit union, never ~0.
    const futureBit = 1n << 12n;
    expect(permsContain(ADMIN_ALL, futureBit)).toBe(false);
  });

  it("keeps MENTION_EVERYONE out of the management mask", () => {
    expect(permsContain(MANAGEMENT_MASK, Permissions.MENTION_EVERYONE)).toBe(
      false,
    );
    expect(permsContain(MANAGEMENT_MASK, Permissions.BAN)).toBe(true);
  });

  it("counts exactly the Control-writing bits as staff", () => {
    // KICK writes to the Guestbook and MANAGE_MESSAGES to Chat planes, so
    // neither needs the control_root (CORD-04 §3).
    for (const bit of [
      Permissions.MANAGE_ROLES,
      Permissions.MANAGE_CHANNELS,
      Permissions.MANAGE_METADATA,
      Permissions.BAN,
      Permissions.CREATE_INVITE,
      Permissions.PIN_MESSAGES,
    ]) {
      expect(permsContain(STAFF_MASK, bit)).toBe(true);
    }
    expect(permsContain(STAFF_MASK, Permissions.KICK)).toBe(false);
    expect(permsContain(STAFF_MASK, Permissions.MANAGE_MESSAGES)).toBe(false);
  });
});

describe("role wire parsing", () => {
  const valid = {
    role_id: roleId("1"),
    name: "Moderator",
    position: 2,
    permissions: "40",
    scope: { kind: "server" },
    color: 15158332,
  };

  it("reads the decimal-string form", () => {
    const r = roleFromJSON(JSON.stringify(valid));
    expect(r?.permissions).toBe(40n);
    expect(r?.position).toBe(2);
    expect(r?.scope).toEqual({ kind: "server" });
  });

  it("accepts a bare number from an older edition", () => {
    expect(
      roleFromJSON(JSON.stringify({ ...valid, permissions: 40 }))?.permissions,
    ).toBe(40n);
  });

  it("survives a permission set past 2^53", () => {
    // The reason the wire form is a string: a JSON number is a float in JS and
    // silently corrupts up here.
    const big = (1n << 62n).toString();
    expect(
      roleFromJSON(JSON.stringify({ ...valid, permissions: big }))?.permissions,
    ).toBe(1n << 62n);
  });

  it("refuses a role claiming position 0", () => {
    // Position 0 is the owner's alone; a Role there would be a peer nobody
    // outranks (CORD-04 §3).
    expect(
      roleFromJSON(JSON.stringify({ ...valid, position: 0 })),
    ).toBeUndefined();
    expect(
      roleFromJSON(JSON.stringify({ ...valid, position: -1 })),
    ).toBeUndefined();
    expect(
      roleFromJSON(JSON.stringify({ ...valid, position: 1.5 })),
    ).toBeUndefined();
  });

  it("refuses malformed ids, permissions and oversize names", () => {
    expect(
      roleFromJSON(JSON.stringify({ ...valid, role_id: "nope" })),
    ).toBeUndefined();
    expect(
      roleFromJSON(JSON.stringify({ ...valid, permissions: "0x28" })),
    ).toBeUndefined();
    expect(
      roleFromJSON(JSON.stringify({ ...valid, name: "é".repeat(33) })),
    ).toBeUndefined(); // 66 bytes
    expect(roleFromJSON("not json")).toBeUndefined();
  });

  it("reads a channel scope, and falls back to server for a malformed one", () => {
    expect(
      roleFromJSON(
        JSON.stringify({
          ...valid,
          scope: { kind: "channel", channel_id: "ff".repeat(32) },
        }),
      )?.scope,
    ).toEqual({ kind: "channel", channelId: "ff".repeat(32) });
    expect(
      roleFromJSON(JSON.stringify({ ...valid, scope: { kind: "channel" } }))
        ?.scope,
    ).toEqual({ kind: "server" });
  });

  it("clamps an out-of-range colour to the theme default", () => {
    expect(roleFromJSON(JSON.stringify({ ...valid, color: -1 }))?.color).toBe(
      0,
    );
    expect(
      roleFromJSON(JSON.stringify({ ...valid, color: 2 ** 33 }))?.color,
    ).toBe(0);
    expect(colorToHex(15158332)).toBe("#e74c3c");
    expect(colorToHex(0)).toBeUndefined();
  });
});

describe("grant wire parsing", () => {
  it("reads a grant and treats empty role_ids as a revoke", () => {
    expect(
      grantFromJSON(JSON.stringify({ member: ALICE, role_ids: [] }))?.roleIds,
    ).toEqual([]);
  });

  it("caps the role list per member", () => {
    const many = Array.from({ length: 100 }, (_, i) => roleId(String(i % 10)));
    expect(
      grantFromJSON(JSON.stringify({ member: ALICE, role_ids: many }))?.roleIds,
    ).toHaveLength(64);
  });

  it("keeps a sanely-sized control_wrap and drops an absurd one", () => {
    // Opaque to us — grimoire never holds a control_root — but a huge value
    // would ride the fold forever.
    expect(
      grantFromJSON(
        JSON.stringify({ member: ALICE, role_ids: [], control_wrap: "abc" }),
      )?.controlWrap,
    ).toBe("abc");
    expect(
      grantFromJSON(
        JSON.stringify({
          member: ALICE,
          role_ids: [],
          control_wrap: "x".repeat(2000),
        }),
      )?.controlWrap,
    ).toBeUndefined();
  });

  it("refuses a malformed member", () => {
    expect(
      grantFromJSON(JSON.stringify({ member: "nope", role_ids: [] })),
    ).toBeUndefined();
  });
});

describe("effective permissions", () => {
  const admin = role({
    roleId: roleId("1"),
    position: 1,
    permissions: ADMIN_ALL,
  });
  const mod = role({
    roleId: roleId("2"),
    position: 2,
    permissions: Permissions.KICK | Permissions.MANAGE_MESSAGES,
  });
  const scoped = role({
    roleId: roleId("3"),
    position: 3,
    permissions: Permissions.MANAGE_MESSAGES,
    scope: { kind: "channel", channelId: "ff".repeat(32) },
  });

  const roles = roster(
    [admin, mod, scoped],
    [
      { member: ALICE, roleIds: [admin.roleId] },
      { member: BOB, roleIds: [mod.roleId, scoped.roleId] },
    ],
  );

  it("unions the bits of every held role", () => {
    expect(effectivePermissions(roles, BOB)).toBe(
      Permissions.KICK | Permissions.MANAGE_MESSAGES,
    );
    expect(effectivePermissions(roles, CAROL)).toBe(0n);
  });

  it("takes the LOWEST position as the member's rank", () => {
    expect(highestPosition(roles, ALICE)).toBe(1);
    expect(highestPosition(roles, BOB)).toBe(2);
    expect(highestPosition(roles, CAROL)).toBeUndefined();
  });

  it("counts a channel-scoped role only for that channel", () => {
    const other = "ee".repeat(32);
    expect(
      isAuthorizedIn(
        roles,
        BOB,
        OWNER,
        "ff".repeat(32),
        Permissions.MANAGE_MESSAGES,
      ),
    ).toBe(true);
    // The server-scope mod role already grants it, so narrow to a bit only the
    // scoped role has to see the scoping actually bite.
    const scopedOnly = roster(
      [scoped],
      [{ member: BOB, roleIds: [scoped.roleId] }],
    );
    expect(effectivePermissionsIn(scopedOnly, BOB, "ff".repeat(32))).toBe(
      Permissions.MANAGE_MESSAGES,
    );
    expect(effectivePermissionsIn(scopedOnly, BOB, other)).toBe(0n);
  });

  it("ignores a grant naming a role that is not in the roster", () => {
    const dangling = roster(
      [admin],
      [{ member: CAROL, roleIds: [roleId("9")] }],
    );
    expect(effectivePermissions(dangling, CAROL)).toBe(0n);
  });
});

describe("owner supremacy and rank", () => {
  const admin = role({
    roleId: roleId("1"),
    position: 1,
    permissions: ADMIN_ALL,
  });
  const peer = role({
    roleId: roleId("2"),
    position: 1,
    permissions: ADMIN_ALL,
  });
  const roles = roster(
    [admin, peer],
    [
      { member: ALICE, roleIds: [admin.roleId] },
      { member: BOB, roleIds: [peer.roleId] },
    ],
  );

  it("authorizes the owner for everything, with no roles at all", () => {
    // The owner's rank comes from the community_id commitment, not the fold.
    expect(isAuthorized(emptyRoles(), OWNER, OWNER, Permissions.BAN)).toBe(
      true,
    );
    expect(hasPermission(emptyRoles(), OWNER, Permissions.BAN)).toBe(false);
  });

  it("never lets anyone act on the owner", () => {
    expect(canActOnMember(roles, ALICE, OWNER, OWNER, Permissions.BAN)).toBe(
      false,
    );
  });

  it("refuses equal-rank action (equal cannot act on equal)", () => {
    // Two Roles MAY share a position — they are peers, and neither acts on the
    // other (CORD-04 §3).
    expect(canActOnMember(roles, ALICE, OWNER, BOB, Permissions.BAN)).toBe(
      false,
    );
    expect(canActOnPosition(roles, ALICE, OWNER, 1, Permissions.BAN)).toBe(
      false,
    );
    expect(canActOnPosition(roles, ALICE, OWNER, 2, Permissions.BAN)).toBe(
      true,
    );
  });

  it("lets any ranked actor act on a roleless member", () => {
    expect(canActOnMember(roles, ALICE, OWNER, CAROL, Permissions.BAN)).toBe(
      true,
    );
    // But a roleless actor outranks nobody.
    expect(canActOnMember(roles, CAROL, OWNER, ALICE, Permissions.BAN)).toBe(
      false,
    );
  });

  it("requires the bit as well as the rank", () => {
    const kicker = role({
      roleId: roleId("3"),
      position: 1,
      permissions: Permissions.KICK,
    });
    const r = roster([kicker], [{ member: ALICE, roleIds: [kicker.roleId] }]);
    expect(canActOnPosition(r, ALICE, OWNER, 9, Permissions.KICK)).toBe(true);
    expect(canActOnPosition(r, ALICE, OWNER, 9, Permissions.BAN)).toBe(false);
  });
});

describe("staff and display tiers", () => {
  it("counts the owner as staff regardless of roles", () => {
    expect(isStaff(emptyRoles(), OWNER, OWNER)).toBe(true);
  });

  it("counts any Control-writing bit as staff, but not KICK alone", () => {
    const kickOnly = role({
      roleId: roleId("1"),
      permissions: Permissions.KICK,
    });
    const banner = role({ roleId: roleId("2"), permissions: Permissions.BAN });
    const r = roster(
      [kickOnly, banner],
      [
        { member: ALICE, roleIds: [kickOnly.roleId] },
        { member: BOB, roleIds: [banner.roleId] },
      ],
    );
    expect(isStaff(r, ALICE, OWNER)).toBe(false);
    expect(isStaff(r, BOB, OWNER)).toBe(true);
  });

  it("badges MANAGE_ROLES as admin and other management as moderator", () => {
    const rolesAdmin = role({
      roleId: roleId("1"),
      permissions: Permissions.MANAGE_ROLES,
    });
    const modOnly = role({
      roleId: roleId("2"),
      permissions: Permissions.KICK,
    });
    const r = roster(
      [rolesAdmin, modOnly],
      [
        { member: ALICE, roleIds: [rolesAdmin.roleId] },
        { member: BOB, roleIds: [modOnly.roleId] },
      ],
    );
    expect(badgeOf(r, ALICE)).toBe("admin");
    expect(badgeOf(r, BOB)).toBe("moderator");
    expect(badgeOf(r, CAROL)).toBeUndefined();
    expect(isAdmin(r, BOB)).toBe(true); // any management bit
  });
});

describe("display order", () => {
  it("orders by position, then by the lower role id", () => {
    const a = role({ roleId: roleId("b"), position: 2 });
    const b = role({ roleId: roleId("a"), position: 2 });
    const c = role({ roleId: roleId("c"), position: 1 });
    expect([a, b, c].sort(byDisplayOrder).map((r) => r.roleId)).toEqual([
      c.roleId,
      b.roleId,
      a.roleId,
    ]);
  });
});
