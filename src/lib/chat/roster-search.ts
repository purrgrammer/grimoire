/**
 * @-autocomplete scoped to the people in the room.
 *
 * The composer's default suggestion source is the global profile index — every
 * profile grimoire has ever seen. In a Concord channel that is the wrong set in
 * both directions: it offers thousands of strangers who will never read the
 * message, and a member with no cached kind-0 does not appear at all, so the
 * one person you actually want to name is the one you cannot.
 *
 * So the ROSTER is the source and the profile index is only a decoration: every
 * result is a member, and a member with no profile still appears (as their npub)
 * and is still mentionable. Rosters are tens to hundreds of entries, so a linear
 * substring pass is cheaper than the index it replaces.
 */

import { nip19 } from "nostr-tools";

import type { ProfileSearchResult } from "@/services/profile-search";

/** Enough of an npub to recognise, for a member with no profile at all. */
function npubLabel(pubkey: string): string {
  try {
    return `${nip19.npubEncode(pubkey).slice(0, 12)}…`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

/**
 * How many members one dropdown may offer.
 *
 * The list is virtualized, so this is about the empty query: opening `@` in a
 * large community should suggest, not dump the membership.
 */
const MAX_RESULTS = 50;

/**
 * A `searchProfiles` function that only ever answers with members of this room.
 *
 * `lookup` is the synchronous profile cache (`profileSearch.getByPubkey`), used
 * to put a name on a pubkey — never to decide who is offered. The order handed
 * in is the order returned, so the owner and the admins lead, as they do in the
 * member list.
 */
export function makeRosterProfileSearch(
  participants: ReadonlyArray<{ pubkey: string }>,
  lookup: (pubkey: string) => ProfileSearchResult | undefined,
): (query: string) => Promise<ProfileSearchResult[]> {
  const members: ProfileSearchResult[] = [];
  const seen = new Set<string>();
  for (const { pubkey } of participants) {
    if (!pubkey || seen.has(pubkey)) continue;
    seen.add(pubkey);
    const profile = lookup(pubkey);
    members.push(
      profile ?? { pubkey, displayName: npubLabel(pubkey) },
      // A member with no kind-0 is still in the room and still mentionable —
      // the editor inserts their pubkey, not their name.
    );
  }

  return async (query: string): Promise<ProfileSearchResult[]> => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members.slice(0, MAX_RESULTS);
    const hits = members.filter((member) =>
      [member.displayName, member.username, member.nip05, member.pubkey].some(
        (field) => field?.toLowerCase().includes(needle),
      ),
    );
    return hits.slice(0, MAX_RESULTS);
  };
}
