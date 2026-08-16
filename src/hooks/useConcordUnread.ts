/**
 * Live unread counts for the Concord sidebar.
 *
 * `useLiveQuery` rather than the wire bus, and that choice is the multi-window
 * mechanism: the bus is in-process, so a second Concord window would never hear
 * the first one mark a channel read. Both the stamps and the messages live in
 * one IndexedDB, and Dexie's observable re-fires every reader when either table
 * is written — by this tab's wire ingest, or by the tab next to it.
 *
 * Each query is a bounded index range with a hard row cap, so a re-run costs a
 * page per channel rather than a scan of the community.
 */

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { use$ } from "applesauce-react/hooks";

import {
  CONCORD_READ_MAX_FUTURE_SECS,
  readCommunityLastReads,
} from "@/services/concord-reads";
import {
  channelUnreadSummary,
  type ChannelUnread,
} from "@/services/concord-rumor-store";
import { readStoredState } from "@/services/concord-state";
import accountManager from "@/services/accounts";
import type { Community } from "@/lib/concord/types";

/** What a community row shows: its channels' unread, added up. */
export interface CommunityUnread {
  count: number;
  mention: boolean;
}

const EMPTY = new Map<string, ChannelUnread>();
const EMPTY_TOTALS = new Map<string, CommunityUnread>();

/** Per-channel unread for one community, keyed by lowercase channel id. */
export function useConcordUnread(
  communityIdHex: string | undefined,
  channelIdsHex: string[],
): Map<string, ChannelUnread> {
  const pubkey = use$(accountManager.active$)?.pubkey;
  // The channel list is a prop rather than something this closure reads,
  // deliberately: resolving it goes through `readStoredState`, which touches
  // `concordKv` — and a liveQuery that touched `concordKv` would re-run on
  // every fold write in the app. This one watches `concordRumors` and
  // `concordReads` and nothing else.
  const key = channelIdsHex.join(",");

  const summaries = useLiveQuery(
    async () => {
      if (!pubkey || !communityIdHex || channelIdsHex.length === 0)
        return EMPTY;
      const stamps = await readCommunityLastReads(pubkey, communityIdHex);
      const nowSecs = Math.floor(Date.now() / 1000);
      const out = new Map<string, ChannelUnread>();
      for (const channelId of channelIdsHex) {
        const id = channelId.toLowerCase();
        out.set(
          id,
          await channelUnreadSummary(communityIdHex, id, {
            after: stamps.get(id) ?? 0,
            nowSecs,
            maxFutureSecs: CONCORD_READ_MAX_FUTURE_SECS,
            selfPubkey: pubkey,
          }),
        );
      }
      return out;
    },
    // `channelIdsHex` is rebuilt from the fold on every read; the joined key is
    // its identity.
    [pubkey, communityIdHex, key],
  );

  return summaries ?? EMPTY;
}

/**
 * Unread totals per community, for the rows of communities not being read.
 *
 * A community's channel list comes from its materialized fold, so it is loaded
 * in a plain effect and handed to the live query — see the note above about why
 * that read must not happen inside it. A community whose fold has not landed
 * yet shows no badge, which is honest: its channels cannot be listed either.
 */
export function useConcordUnreadTotals(
  communities: Community[],
): Map<string, CommunityUnread> {
  const pubkey = use$(accountManager.active$)?.pubkey;
  const [channelsOf, setChannelsOf] = useState<Map<string, string[]>>(
    () => new Map(),
  );
  const communityKey = communities
    .map((c) => `${c.idHex}@${c.rootEpoch}`)
    .join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = new Map<string, string[]>();
      for (const community of communities) {
        const state = await readStoredState(community).catch(() => undefined);
        if (state) {
          found.set(
            community.idHex,
            state.channels.map((ch) => ch.idHex.toLowerCase()),
          );
        }
      }
      if (!cancelled) setChannelsOf(found);
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the (id, epoch) pairs, like `useConcordIcons`: the vault yields
    // fresh objects on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityKey]);

  const directoryKey = [...channelsOf.entries()]
    .map(([id, channels]) => `${id}:${channels.join("+")}`)
    .join(",");

  const totals = useLiveQuery(async () => {
    const out = new Map<string, CommunityUnread>();
    if (!pubkey) return out;
    const nowSecs = Math.floor(Date.now() / 1000);
    for (const [communityId, channelIds] of channelsOf) {
      const stamps = await readCommunityLastReads(pubkey, communityId);
      let count = 0;
      let mention = false;
      for (const channelId of channelIds) {
        const summary = await channelUnreadSummary(communityId, channelId, {
          after: stamps.get(channelId) ?? 0,
          nowSecs,
          maxFutureSecs: CONCORD_READ_MAX_FUTURE_SECS,
          selfPubkey: pubkey,
        });
        count += summary.count;
        mention = mention || summary.mention;
      }
      out.set(communityId, { count, mention });
    }
    return out;
  }, [pubkey, directoryKey]);

  return totals ?? EMPTY_TOTALS;
}
