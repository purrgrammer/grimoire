/**
 * Searching one community's local message history.
 *
 * **The invariant, and the reason this is not a simple Dexie query:** a search
 * result is a strict SUBSET of what the timeline would render. So the scan does
 * not filter rows — it runs each channel through the exact read pipeline the
 * timeline uses (`queryChannelRumors` → stamp the channel's current epoch →
 * `filterEpochCutoff` → `foldTimeline` with `chatModerationOf`) and matches over
 * the FOLDED messages. A banned author's message, a rumor past its CORD-08
 * deadline, a row sealed under a retired epoch and a deleted message are all
 * absent by construction rather than by a second set of rules that could drift
 * from the first. A message that was edited matches its EDITED text, for the
 * same reason: the fold applied the edit before the predicate saw it.
 *
 * Cross-community search is refused by signature. The plane boundary is a
 * correctness rule, not a scoping preference — every store query carries its
 * `communityId` — and one community per call is how that stays true.
 *
 * No relay is involved anywhere in here.
 */

import {
  chatModerationOf,
  filterEpochCutoff,
  foldTimeline,
  type OpenedChat,
} from "@/lib/concord/chat";
import type { FoldedControl } from "@/lib/concord/control";
import {
  contentMatches,
  searchNeedle,
  SEARCHABLE_KINDS,
  SEARCH_RESULT_LIMIT,
  SEARCH_SCAN_LIMIT,
  type ConcordSearchFilters,
} from "@/lib/concord/search";
import type { Channel, Community } from "@/lib/concord/types";
import { queryChannelRumors } from "@/services/concord-rumor-store";

export interface ConcordSearchHit {
  channelIdHex: string;
  channelName: string;
  /** Whether the channel it was found in is a private one. */
  channelPrivate: boolean;
  message: OpenedChat;
}

const searchable = new Set(SEARCHABLE_KINDS);

/** Let the main thread breathe between channels. */
const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Search one community's channels, newest first.
 *
 * `channels` is the caller's own channel view — the private-channel authority.
 * A channel this member holds no key for is not in it, so nothing here has to
 * re-decide who may read what.
 *
 * The scan is per-channel and yields between channels, following the same
 * cooperative pattern as the CORD-08 expiry sweep: a community with many
 * channels is a long walk, and a keystroke behind it deserves to be answered.
 * `signal` is checked at each boundary, so an aborted run stops within one
 * channel rather than at the end.
 */
export async function searchConcordMessages(
  community: Community,
  folded: FoldedControl,
  channels: readonly Channel[],
  filters: ConcordSearchFilters,
  opts?: { signal?: AbortSignal },
): Promise<ConcordSearchHit[]> {
  const needle = searchNeedle(filters);
  if (!needle) return [];

  const allow =
    filters.channelIds.length > 0
      ? new Set(filters.channelIds.map((id) => id.toLowerCase()))
      : undefined;
  const scope = allow
    ? channels.filter((ch) => allow.has(ch.idHex.toLowerCase()))
    : channels;
  if (scope.length === 0) return [];

  const moderation = chatModerationOf(folded, community.id);
  const hits: ConcordSearchHit[] = [];

  for (let i = 0; i < scope.length; i++) {
    if (opts?.signal?.aborted) break;
    const channel = scope[i];
    const rows = await queryChannelRumors(community.idHex, channel.idHex, {
      limit: SEARCH_SCAN_LIMIT,
    });
    // The rows carry no epoch — that lives on the wire — so re-attach the
    // channel's current one, exactly as the timeline read does. Search inherits
    // the timeline's epoch strictness that way: parity, not something stricter.
    const opened: OpenedChat[] = rows.map((row) => ({
      ...row,
      channelIdHex: channel.idHex,
      epoch: channel.current.epoch,
    }));
    const timeline = foldTimeline(
      filterEpochCutoff(opened, channel),
      moderation,
    );
    for (const message of timeline.messages) {
      if (!searchable.has(message.kind)) continue;
      if (!contentMatches(message.content, needle)) continue;
      hits.push({
        channelIdHex: channel.idHex,
        channelName: channel.name,
        channelPrivate: channel.isPrivate,
        message,
      });
    }
    if (i + 1 < scope.length) await yieldToUi();
  }

  // Newest first across the whole community, and only then capped: capping per
  // channel would let a chatty channel crowd out a better match in a quiet one.
  hits.sort((a, b) => b.message.ms - a.message.ms);
  return hits.length > SEARCH_RESULT_LIMIT
    ? hits.slice(0, SEARCH_RESULT_LIMIT)
    : hits;
}
