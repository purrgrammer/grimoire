/**
 * `concord [community]` argument parsing.
 *
 * A Concord community has no shareable public address to type: its id is a hex
 * commitment and its channels live at derived pubkeys, both meaningless without
 * key material. So this resolves against the LOCAL vault instead — the member's
 * own decrypted Community List — by name (case-insensitive, prefix-matched) or
 * by an id prefix. With no argument it opens whatever the viewer holds.
 */

import { loadStoredCommunities } from "@/services/concord-communities";
import accountManager from "@/services/accounts";

export interface ConcordCommandProps {
  /** Full community_id (lowercase hex) when one was resolved. */
  communityId?: string;
  /** The window title to show, when a specific community was named. */
  dynamicTitle?: string;
}

export async function parseConcordCommand(
  args: string[],
): Promise<ConcordCommandProps> {
  const query = args.join(" ").trim();
  if (!query) return {};

  const pubkey = accountManager.active$.value?.pubkey;
  // No account means no vault to search. Hand the raw query through as an id
  // prefix: the viewer resolves prefixes too, and this way `concord <id>` still
  // lands on the right community once a signer arrives.
  if (!pubkey) return { communityId: query.toLowerCase() };

  const communities = await loadStoredCommunities(pubkey);
  const lower = query.toLowerCase();

  const byId =
    /^[0-9a-f]{4,64}$/.test(lower) &&
    communities.find((c) => c.idHex.startsWith(lower));
  const byExactName = communities.find((c) => c.name.toLowerCase() === lower);
  const byNamePrefix = communities.find((c) =>
    c.name.toLowerCase().startsWith(lower),
  );

  const hit = byExactName ?? byId ?? byNamePrefix;
  if (!hit) {
    // Not found is not an error: the vault may simply not have synced yet, and
    // the viewer shows what it does have. Carry the query as a prefix.
    return { communityId: lower };
  }
  return {
    communityId: hit.idHex,
    dynamicTitle: hit.name || hit.idHex.slice(0, 8),
  };
}
