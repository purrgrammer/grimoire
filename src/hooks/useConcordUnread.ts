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
  communityUnread,
  readCommunityLastReads,
} from "@/services/concord-reads";
import {
  channelUnreadSummary,
  type ChannelUnread,
} from "@/services/concord-rumor-store";
import { loadStoredCommunities } from "@/services/concord-communities";
import { readStoredState } from "@/services/concord-state";
import accountManager from "@/services/accounts";
import type { Community } from "@/lib/concord/types";
import type { CommunityUnread } from "@/services/concord-reads";

const EMPTY = new Map<string, ChannelUnread>();
const EMPTY_TOTALS = new Map<string, CommunityUnread>();

/**
 * Per-channel unread for one community, keyed by lowercase channel id.
 *
 * `banned` comes in from the fold for the same reason the channel list does —
 * a row alone cannot say whether its author was banned, and a badge for a
 * message the timeline hides is one the reader cannot clear by reading.
 */
export function useConcordUnread(
  communityIdHex: string | undefined,
  channelIdsHex: string[],
  banned?: ReadonlySet<string>,
): Map<string, ChannelUnread> {
  const pubkey = use$(accountManager.active$)?.pubkey;
  // The channel list is a prop rather than something this closure reads,
  // deliberately: resolving it goes through `readStoredState`, which touches
  // `concordKv` — and a liveQuery that touched `concordKv` would re-run on
  // every fold write in the app. This one watches `concordRumors` and
  // `chatReads` and nothing else.
  const key = channelIdsHex.join(",");
  // The fold hands back a fresh Set every read, so its CONTENT is its identity
  // — without this the query would never re-run on a new ban.
  const bannedKey = banned ? [...banned].sort().join(",") : "";

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
            ...(banned ? { bannedAuthors: banned } : {}),
          }),
        );
      }
      return out;
    },
    // `channelIdsHex` and `banned` are rebuilt from the fold on every read; the
    // joined keys are their identity.
    [pubkey, communityIdHex, key, bannedKey],
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
  const [foldsOf, setFoldsOf] = useState<Map<string, FoldOfCommunity>>(
    () => new Map(),
  );
  const communityKey = communities
    .map((c) => `${c.idHex}@${c.rootEpoch}`)
    .join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = await foldsOfCommunities(communities);
      if (!cancelled) setFoldsOf(found);
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the (id, epoch) pairs, like `useConcordIcons`: the vault yields
    // fresh objects on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityKey]);

  const directoryKey = foldKey(foldsOf);

  const totals = useLiveQuery(async () => {
    const out = new Map<string, CommunityUnread>();
    if (!pubkey) return out;
    const nowSecs = Math.floor(Date.now() / 1000);
    for (const [communityId, fold] of foldsOf) {
      out.set(
        communityId,
        await communityUnread(
          pubkey,
          communityId,
          fold.channelIds,
          nowSecs,
          fold.banned,
        ),
      );
    }
    return out;
  }, [pubkey, directoryKey]);

  return totals ?? EMPTY_TOTALS;
}

/** What a community's materialized fold tells an unread scan. */
interface FoldOfCommunity {
  channelIds: string[];
  banned: ReadonlySet<string>;
}

/**
 * The channels and the banlist of every community whose fold has landed.
 *
 * A community with no stored fold is absent rather than empty: its channels
 * cannot be listed either, so showing no badge for it is the honest answer.
 */
async function foldsOfCommunities(
  communities: Community[],
): Promise<Map<string, FoldOfCommunity>> {
  const found = new Map<string, FoldOfCommunity>();
  for (const community of communities) {
    const state = await readStoredState(community).catch(() => undefined);
    if (!state) continue;
    found.set(community.idHex, {
      channelIds: state.channels.map((ch) => ch.idHex.toLowerCase()),
      banned: state.folded.banned,
    });
  }
  return found;
}

/** Identity of a fold map by CONTENT — every part of it is rebuilt per read. */
function foldKey(folds: Map<string, FoldOfCommunity>): string {
  return [...folds.entries()]
    .map(
      ([id, fold]) =>
        `${id}:${fold.channelIds.join("+")}!${[...fold.banned].sort().join("+")}`,
    )
    .join(",");
}

/**
 * Everything waiting, across every community this account has stored.
 *
 * What a window tile can show: the reader is not looking at the sidebar, so a
 * per-channel number is no use — one number saying "there is something" is.
 * `enabled` is a gate rather than a caller-side `if`, because this runs from
 * the window-title hook, which every open window mounts: without it, ten
 * windows would each re-read the vault to decorate one Concord tile.
 */
export function useConcordUnreadTotal(enabled: boolean): number {
  const pubkey = use$(accountManager.active$)?.pubkey;
  const [foldsOf, setFoldsOf] = useState<Map<string, FoldOfCommunity>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!enabled || !pubkey) return;
    let cancelled = false;
    void (async () => {
      const communities = await loadStoredCommunities(pubkey).catch(() => []);
      const found = await foldsOfCommunities(communities);
      if (!cancelled) setFoldsOf(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, pubkey]);

  const directoryKey = foldKey(foldsOf);

  const total = useLiveQuery(async () => {
    if (!enabled || !pubkey) return 0;
    const nowSecs = Math.floor(Date.now() / 1000);
    let count = 0;
    for (const [communityId, fold] of foldsOf) {
      count += (
        await communityUnread(
          pubkey,
          communityId,
          fold.channelIds,
          nowSecs,
          fold.banned,
        )
      ).count;
    }
    return count;
  }, [enabled, pubkey, directoryKey]);

  return total ?? 0;
}
