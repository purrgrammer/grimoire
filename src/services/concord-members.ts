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
  guestbookFeed,
  snapshotAuthorities,
  type CoalescedMember,
  type CoalesceOptions,
  type GuestbookFeedEntry,
} from "@/lib/concord/guestbook";
import { sweepGuestbook } from "@/lib/concord/plane-sync";
import { isEntitled } from "@/lib/concord/channel-access";
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

/**
 * The gates a Guestbook fold applies, in one place.
 *
 * Shared by the roster and the feed deliberately: the feed renders "was kicked
 * by X" as a fact, so an entry it honours and the roster does not — or the
 * reverse — would be the same plane described two different ways.
 */
function coalesceOptions(
  community: Community,
  folded: FoldedControl,
  dissolvedAtMs: number | undefined,
): CoalesceOptions {
  return {
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
  };
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

  const coalesced = coalesceGuestbook(
    opened,
    coalesceOptions(community, folded, dissolvedAtMs),
  );

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
 * The Guestbook as a feed — every membership event, newest first, plus a row
 * for each currently-banned member.
 *
 * Two things are worth stating about the ban rows, because both are visible in
 * what the UI says:
 *
 * They come from `folded.banned` INTERSECTED with `bannedAt`, not from
 * `bannedAt` alone. `bannedAt` keeps an entry for every npub an authorized
 * Banlist edition ever named — including members since unbanned — so reading it
 * alone would announce bans that have been lifted.
 *
 * And their time is APPROXIMATE. `bannedAt` records the newest edition naming
 * the member, not the moment they were banned, so a Banlist edited afterwards
 * for an unrelated reason moves the timestamp. The UI says "as of" for that
 * reason. Who did the banning is knowable — the edition has an author — but the
 * fold discards it, and carrying it would change the persisted fold shape; that
 * is a separate change.
 */
export async function readGuestbookFeed(
  community: Community,
  folded: FoldedControl,
): Promise<GuestbookFeedEntry[]> {
  const [opened, dissolvedAtMs] = await Promise.all([
    queryPlane(community.idHex, "guestbook"),
    dissolvedAt(community.idHex),
  ]);

  const feed = guestbookFeed(
    opened,
    coalesceOptions(community, folded, dissolvedAtMs),
  );

  const bans: GuestbookFeedEntry[] = [];
  for (const pubkey of folded.banned) {
    const at = folded.bannedAt.get(pubkey);
    if (at === undefined) continue;
    // `bannedAt` is in SECONDS; every other time on this feed is ms.
    bans.push({ kind: "ban", pubkey, ms: at * 1000 });
  }
  if (bans.length === 0) return feed;
  return [...feed, ...bans].sort((a, b) => b.ms - a.ms);
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
  /**
   * The channel being viewed. For a PRIVATE channel the list is narrowed to
   * whoever holds its key, because the community roster is the wrong answer
   * there: a private channel's audience is the granted role-holders (CORD-03),
   * and showing every member implies an audience the room does not have.
   *
   * Entitlement is who the key was DELIVERED to, not who can read — key
   * possession is the only real enforcement (CORD-04 §1), and a member whose
   * role was revoked keeps reading until the rekey lands. So this is the
   * community's intent, which is what a member list should show.
   */
  channel?: {
    idHex: string;
    isPrivate: boolean;
    authors?: ReadonlySet<string>;
  },
): Array<{ pubkey: string; role: "admin" | "moderator" | "member" }> {
  const visible =
    channel?.isPrivate === true
      ? [...roster.members].filter(
          (pubkey) =>
            isEntitled(folded.roster, folded.ownerHex, pubkey, channel.idHex) ||
            // …OR observably holding the key. Entitlement is who the key was
            // DELIVERED to, which a lagging or partial fold can understate — a
            // member whose grant this client has not read yet, or who was let
            // in by a route the roster does not describe, would otherwise
            // vanish from a room they are demonstrably in. Publishing under the
            // channel key is proof; the roster is only intent.
            channel.authors?.has(pubkey) === true,
        )
      : [...roster.members];
  return [
    { pubkey: folded.ownerHex, role: "admin" as const },
    ...visible
      .filter((pubkey) => pubkey !== folded.ownerHex)
      .map((pubkey) => ({
        pubkey,
        role: badgeOf(folded.roster, pubkey) ?? ("member" as const),
      })),
  ];
}

/**
 * Sweep the Guestbook, then fold the roster — or skip the fold when the sweep
 * found nothing.
 *
 * Folding costs a full scan of the community's messages (the observed half), so
 * a caller that has already read the stored roster and is only refreshing
 * behind it should not pay for a second one that can only produce the same
 * answer. Returns undefined when nothing changed.
 */
export async function syncRoster(
  community: Community,
  folded: FoldedControl,
): Promise<Roster | undefined> {
  // Off-consensus: a failed sweep folds whatever the store already holds rather
  // than failing the read. Nothing in Control or Chat depends on this plane.
  const fresh = await sweepGuestbook(community).catch((error: unknown) => {
    console.debug("[concord] guestbook sweep failed:", error);
    return [];
  });
  if (fresh.length === 0) return undefined;
  return readStoredRoster(community, folded);
}
