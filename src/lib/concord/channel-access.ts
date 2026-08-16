/**
 * Who may read a Private Channel — CORD-03/04/06, read side.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/channelAccess.ts`), minus the
 * invite-vending half: grimoire delivers no keys.
 *
 * CORD-03 defines the two channel kinds by exactly this question: a Public
 * Channel derives its key from the `community_root` and is readable by every
 * member; a Private Channel is readable only by granted role-holders, its key
 * an independent random secret delivered on grant and rekeyed on removal
 * (CORD-06). CORD-04 §2 carries the binding that names those role-holders — a
 * Role's `scope: {kind:"channel", channelId}`.
 *
 * So the roles scoped to a channel ARE its access list. Read access is still
 * enforced by key possession alone (CORD-04 §1) and nothing here grants it;
 * this is who the key was delivered to, which is what a member list should show
 * for a private room.
 */

import {
  byDisplayOrder,
  rolesOf,
  type CommunityRoles,
  type Role,
} from "@/lib/concord/roles";

/**
 * The Roles conferring read access to `channelIdHex`, in display order.
 *
 * A Private Channel with none is readable by nobody but the owner and whoever
 * already holds the key. That is a degenerate configuration rather than an open
 * one — a private channel readable by every member is strictly worse than a
 * public one — but a channel arriving that way from elsewhere still reads
 * correctly here.
 */
export function channelRoles(
  roster: CommunityRoles | undefined,
  channelIdHex: string,
): Role[] {
  const wanted = channelIdHex.toLowerCase();
  return (roster?.roles ?? [])
    .filter(
      (r) =>
        r.scope.kind === "channel" &&
        r.scope.channelId.toLowerCase() === wanted,
    )
    .sort(byDisplayOrder);
}

/** {@link channelRoles}, by id. */
export function channelRoleIds(
  roster: CommunityRoles | undefined,
  channelIdHex: string,
): string[] {
  return channelRoles(roster, channelIdHex).map((r) => r.roleId);
}

/**
 * Is `memberHex` entitled to `channelIdHex`'s key? The owner always is
 * (position 0, supreme and unremovable — CORD-04 §2).
 */
export function isEntitled(
  roster: CommunityRoles | undefined,
  ownerHex: string | undefined,
  memberHex: string,
  channelIdHex: string,
): boolean {
  if (memberHex === ownerHex) return true;
  if (!roster) return false;
  const held = new Set(rolesOf(roster, memberHex).map((r) => r.roleId));
  return channelRoleIds(roster, channelIdHex).some((id) => held.has(id));
}
