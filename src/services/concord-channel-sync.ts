/**
 * One channel's Chat Plane: backfill the wraps, decode once, store the rumors.
 *
 * Chat is read back from the STORE, never straight off the wire (see
 * `concord-rumor-store.ts`): a wrap is opened once at ingest and the rumor its
 * author signed is what persists, so a timeline read is an indexed query with no
 * crypto. This module is the only thing that puts chat rumors there.
 *
 * A channel is not one address. It accumulates a stream per held epoch — root
 * epochs for what it wrote while public, channel keys current and prior for each
 * private epoch — and history spans all of them. Reading only the current one is
 * why rotating a key appears to erase the conversation.
 */

import { openChatBatch, type OpenedChat } from "@/lib/concord/chat";
import { KIND_WRAP } from "@/lib/concord/kinds";
import { planeRequest } from "@/lib/concord/plane-request";
import { streamAuthsSettled } from "@/lib/concord/stream-auth";
import type { Channel, Community } from "@/lib/concord/types";
import { writeChatRumors } from "@/services/concord-rumor-store";
import type { RelayPool } from "applesauce-relay";

/** Per-request page size. Chat is read forward from the store, so this only
 *  bounds one relay answer. */
const PAGE_LIMIT = 300;

export interface ChannelSyncResult {
  /** Freshly decoded and stored rumors (empty on a warm read). */
  fresh: OpenedChat[];
  /** Whether any relay answered at all — refused and dead relays do not count. */
  answered: boolean;
  /** Whether a relay's NIP-42 gate turned us away for every stream. */
  refused: boolean;
}

/**
 * Fetch a channel's newest wraps across every held epoch and ingest them.
 *
 * One REQ per (relay, epoch): the addresses are distinct derived pubkeys, and a
 * single multi-author filter would let one busy epoch's page cap starve the
 * others. `until` walks a channel backwards for pagination.
 */
export async function syncChannel(
  community: Community,
  channel: Channel,
  opts: {
    until?: number;
    limit?: number;
    pool?: RelayPool;
    /**
     * Called each time a relay's page has been decoded and stored.
     *
     * Progressive on purpose. Waiting for every (relay, stream) pair before
     * showing anything means the slowest relay sets the time to first message —
     * and a relay that accepts a REQ and never answers holds the channel on
     * "Loading messages…" for the full request deadline while another relay
     * already handed over the history.
     */
    onFresh?: (fresh: OpenedChat[]) => void;
  } = {},
): Promise<ChannelSyncResult> {
  const limit = opts.limit ?? PAGE_LIMIT;
  const fresh: OpenedChat[] = [];
  let answered = false;
  let refused = false;

  const reads = community.relays.flatMap((url) =>
    channel.streams.map(async (stream) => {
      const filter = {
        kinds: [KIND_WRAP],
        authors: [stream.group.pk],
        limit,
        ...(opts.until !== undefined ? { until: opts.until } : {}),
      };
      let result = await planeRequest(url, filter, { pool: opts.pool });
      // Same discipline as the control sweep: a plane REQ racing the NIP-42
      // challenge is the common path on grimoire's pool, and an empty page from
      // an unacked socket is a refusal, not an empty channel.
      if (
        result.outcome === "refused" ||
        (result.events.length === 0 &&
          !streamAuthsSettled(url, [stream.group.pk]))
      ) {
        result = await planeRequest(url, filter, { pool: opts.pool });
      }
      if (result.outcome === "eose") answered = true;
      else if (result.outcome === "refused") refused = true;
      if (result.events.length === 0) return;

      // Decode and store THIS page rather than pooling for the round. The decode
      // memo is keyed by wrap id, so the same wrap served by a second relay
      // still costs one decrypt.
      const opened = await openChatBatch(result.events, channel);
      if (opened.length === 0) return;
      const stored = await writeChatRumors(
        community.idHex,
        opened.map((ev) => ({ ...ev, channel: ev.channelIdHex })),
      );
      if (!stored.ok) return;
      fresh.push(...opened);
      opts.onFresh?.(opened);
    }),
  );

  await Promise.all(reads);
  return { fresh, answered, refused };
}
