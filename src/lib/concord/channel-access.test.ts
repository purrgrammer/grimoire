/**
 * Who a Private Channel's key was delivered to (CORD-03/04). Ported from
 * armada `bc19d1f`.
 */

import { describe, expect, it } from "vitest";

import {
  channelRoleIds,
  channelRoles,
  isEntitled,
} from "@/lib/concord/channel-access";
import { Permissions, type CommunityRoles } from "@/lib/concord/roles";

const OWNER = "aa".repeat(32);
const ALICE = "bb".repeat(32);
const BOB = "cc".repeat(32);
const PRIVATE = "11".repeat(32);
const OTHER = "22".repeat(32);

const role = (
  roleId: string,
  channelId: string | undefined,
  position: number,
) => ({
  roleId,
  name: roleId,
  position,
  permissions: Permissions.KICK,
  scope: channelId
    ? ({ kind: "channel", channelId } as const)
    : ({ kind: "server" } as const),
  color: 0,
});

const roster: CommunityRoles = {
  roles: [
    role("testers", PRIVATE, 2),
    role("leads", PRIVATE, 1),
    role("mods", undefined, 1),
    role("elsewhere", OTHER, 1),
  ],
  grants: [
    { member: ALICE, roleIds: ["testers"] },
    { member: BOB, roleIds: ["mods", "elsewhere"] },
  ],
};

describe("channelRoles", () => {
  it("is the roles SCOPED to that channel, in display order", () => {
    // The scoped roles ARE the access list (CORD-04 §2).
    expect(channelRoleIds(roster, PRIVATE)).toEqual(["leads", "testers"]);
  });

  it("matches the channel id case-insensitively", () => {
    expect(channelRoleIds(roster, PRIVATE.toUpperCase())).toEqual([
      "leads",
      "testers",
    ]);
  });

  it("is empty for a channel no role names", () => {
    expect(channelRoles(roster, "33".repeat(32))).toEqual([]);
  });
});

describe("isEntitled", () => {
  it("admits a holder of a role scoped to the channel", () => {
    expect(isEntitled(roster, OWNER, ALICE, PRIVATE)).toBe(true);
  });

  it("refuses a member whose roles are scoped elsewhere", () => {
    // Bob is staff, and holds a role on ANOTHER channel. Neither reaches this
    // one — a server-wide role is not a key to every private room.
    expect(isEntitled(roster, OWNER, BOB, PRIVATE)).toBe(false);
  });

  it("refuses a member with no roles at all", () => {
    expect(isEntitled(roster, OWNER, "dd".repeat(32), PRIVATE)).toBe(false);
  });

  it("always admits the owner — position 0, supreme and unremovable", () => {
    expect(isEntitled(roster, OWNER, OWNER, PRIVATE)).toBe(true);
    expect(isEntitled(roster, OWNER, OWNER, "99".repeat(32))).toBe(true);
  });

  it("refuses everyone but the owner when the roster is unknown", () => {
    expect(isEntitled(undefined, OWNER, ALICE, PRIVATE)).toBe(false);
    expect(isEntitled(undefined, OWNER, OWNER, PRIVATE)).toBe(true);
  });
});
