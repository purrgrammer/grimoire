/**
 * Concord read state — how far into each channel this account has caught up.
 *
 * Entirely client-local and never published. No CORD document defines a read
 * marker, and armada's only cross-device path is a NIP-78 settings upload,
 * which grimoire does not do: this client uploads nothing but the messages the
 * user types. So a stamp lives in Dexie on this device and nowhere else.
 *
 * Dexie rather than localStorage or a jotai atom because the requirement is
 * multi-WINDOW: `grimoireStateAtom`'s storage has no `subscribe`, and the
 * in-process wire bus cannot cross a tab. Two Concord windows over one
 * IndexedDB both see each other's marks (and each other's ingested rumors)
 * through `useLiveQuery`.
 *
 * This module stays PURE about the stamp: it stores what it is given, only ever
 * forwards, and knows nothing about clock skew or about the rows a fold hides.
 * That composition belongs to the Concord adapter's `markRead`, which is the
 * only caller that can see both halves — see the invariant documented there and
 * on {@link CONCORD_READ_MAX_FUTURE_SECS}.
 */

import { channelUnreadSummary } from "@/services/concord-rumor-store";
import db, { type ConcordReadRow } from "@/services/db";

/**
 * How far ahead of the local clock a rumor may be dated and still count.
 *
 * Chat ingest has NO far-future guard — `writeChatRumors` refuses an already
 * EXPIRED rumor and nothing else — so a member can date a message the year 3000
 * and have it stored. Both the unread scan and the stamp are bounded by this,
 * and they must be bounded by the SAME number: bound only the stamp and a
 * future-dated row pins the badge forever; bound only the scan and stamping
 * `latest` marks the channel read until the year 3000 arrives.
 *
 * One hour, mirroring `GUESTBOOK_MAX_FUTURE_MS` — the one place in the port
 * that already had to pick a tolerance for a peer's clock. Self-healing: a row
 * beyond the window starts counting, and becomes stampable, when the clock
 * catches up to it.
 */
export const CONCORD_READ_MAX_FUTURE_SECS = 3600;

const key = (
  pubkey: string,
  communityId: string,
  channelId: string,
): [string, string, string] => [
  pubkey,
  communityId.toLowerCase(),
  channelId.toLowerCase(),
];

/**
 * This account's last-read stamp for one channel, in unix SECONDS.
 *
 * 0 for a channel never opened — and 0 is load-bearing rather than a null
 * stand-in: it means "everything is unread", which is what makes a freshly
 * joined community badge every channel, while the divider treats it as "do not
 * flag a history the reader has never seen".
 *
 * Degrades to 0 on a storage error rather than throwing: a badge that reads
 * high is a far smaller failure than a channel that will not open.
 */
export async function readLastRead(
  pubkey: string,
  communityId: string,
  channelId: string,
): Promise<number> {
  if (!pubkey || !communityId || !channelId) return 0;
  try {
    const row = await db.concordReads.get(key(pubkey, communityId, channelId));
    return row?.lastRead ?? 0;
  } catch (error) {
    console.warn("[concord] could not read the last-read stamp:", error);
    return 0;
  }
}

/**
 * Every stamp this account holds in one community, by lowercase channel id.
 *
 * One index range rather than a read per channel: the sidebar asks about every
 * channel at once, on every re-render the live query fires.
 */
export async function readCommunityLastReads(
  pubkey: string,
  communityId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!pubkey || !communityId) return out;
  try {
    const rows = await db.concordReads
      .where("[pubkey+communityId]")
      .equals([pubkey, communityId.toLowerCase()])
      .toArray();
    for (const row of rows) out.set(row.channelId, row.lastRead);
  } catch (error) {
    console.warn("[concord] could not read this community's stamps:", error);
  }
  return out;
}

/**
 * Move one channel's stamp forward. Never backwards.
 *
 * Monotonic inside a transaction, not merely in the caller: two Concord windows
 * marking the same channel at once would otherwise read the same old value and
 * the slower write would win, silently rewinding the faster one's mark. The
 * read-compare-write is one `rw` transaction so the loser re-reads.
 *
 * A zero or negative stamp is ignored: it is what an empty channel produces,
 * and writing it would replace a real stamp with nothing.
 */
export async function markChannelRead(
  pubkey: string,
  communityId: string,
  channelId: string,
  timestampSecs: number,
): Promise<void> {
  if (!pubkey || !communityId || !channelId) return;
  if (!Number.isFinite(timestampSecs) || timestampSecs <= 0) return;
  const id = key(pubkey, communityId, channelId);
  try {
    await db.transaction("rw", db.concordReads, async () => {
      const existing = await db.concordReads.get(id);
      if (existing && existing.lastRead >= timestampSecs) return;
      const row: ConcordReadRow = {
        pubkey: id[0],
        communityId: id[1],
        channelId: id[2],
        lastRead: timestampSecs,
        updatedAt: Date.now(),
      };
      await db.concordReads.put(row);
    });
  } catch (error) {
    console.warn("[concord] could not stamp the channel as read:", error);
  }
}

/** One community's channels, added up. */
export interface CommunityUnread {
  count: number;
  mention: boolean;
}

/**
 * What one community has waiting, across the channels it was handed.
 *
 * The channel list is an ARGUMENT rather than something this reads, and that is
 * a constraint from the hooks above it: resolving a community's channels goes
 * through the materialized fold in `concordKv`, and a Dexie live query that
 * touched `concordKv` would re-run on every fold write in the app. Here the
 * only tables touched are `concordReads` and `concordRumors`.
 */
export async function communityUnread(
  pubkey: string,
  communityId: string,
  channelIdsHex: readonly string[],
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<CommunityUnread> {
  const total: CommunityUnread = { count: 0, mention: false };
  if (!pubkey || !communityId || channelIdsHex.length === 0) return total;
  const stamps = await readCommunityLastReads(pubkey, communityId);
  for (const channelId of channelIdsHex) {
    const id = channelId.toLowerCase();
    const summary = await channelUnreadSummary(communityId, id, {
      after: stamps.get(id) ?? 0,
      nowSecs,
      maxFutureSecs: CONCORD_READ_MAX_FUTURE_SECS,
      selfPubkey: pubkey,
    });
    total.count += summary.count;
    total.mention = total.mention || summary.mention;
  }
  return total;
}

/**
 * Drop every stamp belonging to one account.
 *
 * The logout wipe's door. Unlike the rumor store beside it this table IS
 * account-scoped — the standalone `pubkey` index exists for exactly this — so a
 * logout takes only the account that left.
 */
export async function clearReads(pubkey: string): Promise<void> {
  if (!pubkey) return;
  await db.concordReads.where("pubkey").equals(pubkey).delete();
}
