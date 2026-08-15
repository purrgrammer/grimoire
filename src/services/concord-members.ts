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
import { canActOnMember, Permissions } from "@/lib/concord/roles";
import type { Community } from "@/lib/concord/types";
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
  const [opened, observed] = await Promise.all([
    queryPlane(community.idHex, "guestbook"),
    observedAuthors(community.idHex),
  ]);

  const coalesced = coalesceGuestbook(opened, {
    nowMs: Date.now(),
    canKick: (actor, target, citation) =>
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
    // TEMPORARY WIDENING, tied to phase 9. Armada also refuses a kick published
    // AFTER the dissolution tombstone (CORD-02 §9, death wins every race), as an
    // ordering rule rather than a blanket one — the coalesce replays history, so
    // refusing every kick in a dissolved community would un-kick everyone the
    // moment it died. Grimoire has no dissolved-state read yet, so post-tombstone
    // kicks are honored here. It widens what we honor, never narrows it, and the
    // only communities affected are dead ones.
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
