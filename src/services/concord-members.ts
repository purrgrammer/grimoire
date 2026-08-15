/**
 * One community's roster: sweep the Guestbook, coalesce it, merge the observed
 * authors, subtract the Banlist.
 *
 * The same three-layer shape as `concord-state.ts`, and the only place that
 * knows the order:
 *
 *   plane-sync   fetch + decrypt + store      (facts about the fetch)
 *   guestbook    coalesce + complete          (facts about membership)
 *   this         compose them with the fold   (what the roster renders)
 *
 * Like the control state, the fold reads the STORE rather than the sweep's
 * return value: a sweep that returns nothing fresh has still confirmed the
 * plane, and a cold launch coalesces entries decrypted in a previous session.
 */

import { citationSatisfied, type FoldedControl } from "@/lib/concord/control";
import {
  coalesceGuestbook,
  completeMemberlist,
  snapshotAuthorities,
  type CoalescedMember,
} from "@/lib/concord/guestbook";
import { sweepGuestbook } from "@/lib/concord/plane-sync";
import { badgeOf, canActOnMember, Permissions } from "@/lib/concord/roles";
import type { Community } from "@/lib/concord/types";
import { dissolvedAt } from "@/services/concord-dissolution";
import { observedAuthors, queryPlane } from "@/services/concord-rumor-store";

export interface Roster {
  /** The Complete Memberlist (CORD-02 §5), lowercase hex pubkeys. */
  members: Set<string>;
  /** The coalesced Guestbook behind it — join/leave/kick state per npub. */
  coalesced: Map<string, CoalescedMember>;
}

/** Fold the roster from what the store already holds. No network. */
export async function readStoredRoster(
  community: Community,
  folded: FoldedControl,
): Promise<Roster> {
  const [opened, observed, dissolvedAtMs] = await Promise.all([
    queryPlane(community.idHex, "guestbook"),
    observedAuthors(community.idHex),
    dissolvedAt(community.idHex),
  ]);

  const coalesced = coalesceGuestbook(opened, {
    nowMs: Date.now(),
    canKick: (actor, target, citation, atMs) =>
      // Death wins every race (CORD-02 §9) — but as an ORDERING rule, since the
      // coalesce replays history: only a kick published AFTER the tombstone is
      // refused. A blanket refusal would un-kick everyone the community ever
      // kicked, the moment it died.
      !(dissolvedAtMs !== undefined && atMs > dissolvedAtMs) &&
      // KICK bit + strict outrank against the folded roster…
      canActOnMember(
        folded.roster,
        actor,
        folded.ownerHex,
        target,
        Permissions.KICK,
      ) &&
      // …and the CORD-04 §5 sync floor, so a kick from an admin whose demotion
      // we have not read yet parks instead of landing.
      citationSatisfied(folded, community.id, actor, citation),
    snapshotAuthorities: snapshotAuthorities(community),
    banned: folded.banned,
  });

  return {
    members: completeMemberlist(
      coalesced,
      observed,
      folded.banned,
      folded.bannedAt,
    ),
    coalesced,
  };
}

/**
 * The roster as a chat viewer's participant list: the proven owner first, then
 * every member with their display tier.
 *
 * `badgeOf`, NOT an `isAuthorized` permission mask. Permission checks here are
 * ALL-BITS — `(perms & bits) === bits` — so testing against the management mask
 * labels a real moderator "member" unless they happen to hold every admin bit
 * at once. This is the tier armada's own member list shows: MANAGE_ROLES is
 * "admin", any other management bit is "moderator".
 */
export function rosterParticipants(
  roster: Roster,
  folded: FoldedControl,
): Array<{ pubkey: string; role: "admin" | "moderator" | "member" }> {
  return [
    { pubkey: folded.ownerHex, role: "admin" as const },
    ...[...roster.members]
      .filter((pubkey) => pubkey !== folded.ownerHex)
      .map((pubkey) => ({
        pubkey,
        role: badgeOf(folded.roster, pubkey) ?? ("member" as const),
      })),
  ];
}

/** Sweep the Guestbook, then fold the roster. */
export async function syncRoster(
  community: Community,
  folded: FoldedControl,
): Promise<Roster> {
  // Off-consensus: a failed sweep folds whatever the store already holds rather
  // than failing the read. Nothing in Control or Chat depends on this plane.
  await sweepGuestbook(community).catch((error: unknown) => {
    console.debug("[concord] guestbook sweep failed:", error);
    return [];
  });
  return readStoredRoster(community, folded);
}
