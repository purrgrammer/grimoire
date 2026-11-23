/**
 * Resolving a Concord community named on the command line (`chat`, `call`).
 *
 * A Concord community has no shareable public address to type: its id is a hex
 * commitment and its channels live at derived pubkeys, both meaningless without
 * key material. So this resolves against the LOCAL vault instead — the member's
 * own decrypted Community List — by name (case-insensitive, prefix-matched) or
 * by an id prefix.
 */

import { loadStoredCommunities } from "@/services/concord-communities";
import { readStoredState } from "@/services/concord-state";
import accountManager from "@/services/accounts";
import { parseGroupArgs } from "@/lib/nip29/group-selection";

export interface CommunityQueryProps {
  /** Full community_id (lowercase hex) when one was resolved. */
  communityId?: string;
  /** The window title to show, when a specific community was named. */
  dynamicTitle?: string;
}

export interface CallCommandProps {
  /**
   * Which kind of space this window holds. Absent means Concord, so a window
   * saved before relay groups were callable still opens as what it was.
   */
  protocol?: "concord" | "nip-29";
  /** Concord: the community, lowercase hex. */
  communityId?: string;
  /** Concord: the channel, lowercase hex. */
  channelId?: string;
  /** NIP-29: the relay hosting the group. */
  relayUrl?: string;
  /** NIP-29: the group id, VERBATIM — `#d` is case-sensitive. */
  groupId?: string;
}

/**
 * `call [community [channel]]`.
 *
 * A call has no address a person could type: its room name derives from the
 * channel key, so what is resolved here is the same LOCAL vault `chat`
 * searches — a community by name or id prefix, then a channel within it by name
 * or id prefix.
 *
 * It exists mostly so a window round-trips. The window is normally opened from
 * the channel header, which already knows exactly which channel it is, and that
 * writes both ids into the window's props; without a parser that can read them
 * back, editing the window would collapse it to a bare `call` pointing at
 * nothing. With no arguments it shows whatever call is running.
 */
export async function parseCallCommand(
  args: string[],
): Promise<CallCommandProps> {
  const pubkey = accountManager.active$.value?.pubkey;
  const [communityQuery, ...rest] = args;
  if (!communityQuery) return {};

  // A relay group DOES have an address a person can type, unlike a Concord
  // channel — so `call relay.example.com'pizza` is unambiguous and needs no
  // local lookup at all.
  const group = parseGroupArgs(args);
  if (group) {
    return {
      protocol: "nip-29",
      relayUrl: group.relayUrl,
      groupId: group.groupId,
    };
  }

  const channelQuery = rest.join(" ").trim();
  if (!pubkey) {
    return {
      protocol: "concord",
      communityId: communityQuery.toLowerCase(),
      ...(channelQuery ? { channelId: channelQuery.toLowerCase() } : {}),
    };
  }

  const { communityId } = await resolveCommunityQuery(communityQuery);
  if (!communityId || !channelQuery) {
    return communityId ? { protocol: "concord", communityId } : {};
  }

  const communities = await loadStoredCommunities(pubkey);
  const community = communities.find((c) => c.idHex === communityId);
  if (!community) return { protocol: "concord", communityId };
  const state = await readStoredState(community).catch(() => undefined);
  const lower = channelQuery.toLowerCase();
  const channels = state?.channels ?? [];
  const hit =
    channels.find((ch) => ch.idHex === lower) ??
    channels.find((ch) => ch.name.toLowerCase() === lower) ??
    channels.find((ch) => ch.idHex.startsWith(lower)) ??
    channels.find((ch) => ch.name.toLowerCase().startsWith(lower));
  return {
    protocol: "concord",
    communityId,
    ...(hit ? { channelId: hit.idHex } : {}),
  };
}

/**
 * A community this account actually holds, or nothing.
 *
 * Split out from {@link resolveCommunityQuery} because `chat` needs to tell a
 * HIT from a miss, and that one deliberately cannot: it carries an unresolved
 * query through as an id prefix. `chat` shares its argument with
 * every NIP-19 identifier there is, so it may only claim a query the vault can
 * vouch for — a miss has to go on and be tried as a note, a profile or a group.
 */
export async function resolveStoredCommunity(
  query: string,
): Promise<Required<CommunityQueryProps> | undefined> {
  const pubkey = accountManager.active$.value?.pubkey;
  if (!pubkey || !query.trim()) return undefined;

  const communities = await loadStoredCommunities(pubkey);
  const lower = query.trim().toLowerCase();

  // `undefined` rather than `false` when the query is not hex-shaped: `??`
  // only falls through on null and undefined, so a `false` here swallowed the
  // name-prefix match behind it — `chat bitcoin`, a documented example,
  // resolved to nothing.
  const byId = /^[0-9a-f]{4,64}$/.test(lower)
    ? communities.find((c) => c.idHex.startsWith(lower))
    : undefined;
  const byExactName = communities.find((c) => c.name.toLowerCase() === lower);
  const byNamePrefix = communities.find((c) =>
    c.name.toLowerCase().startsWith(lower),
  );

  const hit = byExactName ?? byId ?? byNamePrefix;
  if (!hit) return undefined;
  return {
    communityId: hit.idHex,
    dynamicTitle: hit.name || hit.idHex.slice(0, 8),
  };
}

/**
 * A community query as `call` needs it: the vault's hit when there is one, the
 * raw query as an id prefix otherwise.
 */
async function resolveCommunityQuery(
  query: string,
): Promise<CommunityQueryProps> {
  const trimmed = query.trim();
  if (!trimmed) return {};

  const pubkey = accountManager.active$.value?.pubkey;
  // No account means no vault to search. Hand the raw query through as an id
  // prefix: the viewer resolves prefixes too, and this way `call <id>` still
  // lands on the right community once a signer arrives.
  if (!pubkey) return { communityId: trimmed.toLowerCase() };

  const hit = await resolveStoredCommunity(trimmed);
  // Not found is not an error: the vault may simply not have synced yet, and
  // the viewer shows what it does have. Carry the query as a prefix.
  return hit ?? { communityId: trimmed.toLowerCase() };
}
