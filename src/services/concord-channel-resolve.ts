/**
 * One channel, with the community and control fold behind it.
 *
 * Its own module because two callers need the same answer and neither can own
 * it: the chat adapter resolves a channel to read and to send in it, and the
 * outbox drain resolves the same channel from a wire doorbell, where no adapter
 * instance exists. The refusals are the interesting part and are shared with
 * the resolution — a locked vault, a Refounded community whose snapshot has not
 * landed, and a channel this member holds no key for all read differently to a
 * user and identically to the code that has to stop.
 */

import { channelsView } from "@/lib/concord/channels";
import type { FoldedControl } from "@/lib/concord/control";
import type { Channel, Community } from "@/lib/concord/types";
import accountManager from "@/services/accounts";
import { loadStoredCommunities } from "@/services/concord-communities";
import { foldStoredControl } from "@/services/concord-state";

export interface ResolvedChannel {
  community: Community;
  channel: Channel;
  folded: FoldedControl;
}

export async function resolveChannel(
  communityId: string,
  channelId: string,
): Promise<ResolvedChannel> {
  const pubkey = accountManager.active$.value?.pubkey;
  if (!pubkey) throw new Error("No active account");

  const communities = await loadStoredCommunities(pubkey);
  const community = communities.find((c) => c.idHex === communityId);
  if (!community) {
    throw new Error("That community is not in your Community List");
  }
  const folded = await foldStoredControl(community);
  if (!folded) {
    // A Refounded community whose compaction snapshot has not been recorded
    // yet. Folding by old-root contiguity would anchor on a superseded
    // fragment, so there is nothing safe to resolve against.
    throw new Error(
      "Still catching up with this community — try again in a moment.",
    );
  }
  const channel = channelsView(community, folded).find(
    (ch) => ch.idHex === channelId,
  );
  if (!channel) {
    // Either the channel was deleted, or it is private and this member holds no
    // key for it. Both read the same from here, and both mean the same thing to
    // the reader: there is nothing to show.
    throw new Error("That channel is not readable with the keys you hold");
  }
  return { community, channel, folded };
}
