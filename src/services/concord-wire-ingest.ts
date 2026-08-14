/**
 * The wire's single ingestion point: decode → store → ring the doorbell.
 *
 * Ported from armada `bc19d1f` (`src/wire/ingest.ts`), narrowed to Concord.
 * Every wrap the wire receives funnels through here, so there is exactly one
 * routing rule:
 *
 * - a wrap authored by a channel stream we hold → open with that channel's keys
 *   → the rumor store → ring `c2:<channel>`;
 * - a wrap authored by a control stream we hold → open with that community's
 *   control keys → the rumor store → ring `c2ctl:<community>`;
 * - anything else → PARK it, and ring `c2park:<streamPk>` so a holder of that
 *   key can drain it.
 *
 * Writes land BEFORE the scope is announced, always. The bus is a doorbell and
 * the store is the source of truth, so a listener that re-reads on a ring must
 * find the thing that caused it.
 */

import { openChatBatch } from "@/lib/concord/chat";
import { KIND_WRAP } from "@/lib/concord/kinds";
import {
  notePlaneWrapsJunk,
  notePlaneWrapsSeen,
  openPlaneWraps,
  unseenPlaneWraps,
} from "@/lib/concord/plane-sync";
import type { Channel } from "@/lib/concord/types";
import {
  channelScope,
  controlScope,
  emitWireScopes,
  parkScope,
  type WireScope,
} from "@/lib/concord/wire-bus";
import type { WireControlTarget, WireSpec } from "@/lib/concord/wire-spec";
import {
  ackPendingWraps,
  parkPendingWraps,
  peekPendingWraps,
  writeChatRumors,
  writeOpened,
} from "@/services/concord-rumor-store";
import type { NostrEvent } from "nostr-tools";

/**
 * Gift-wrap kinds. 21059 (ephemeral — typing, voice presence) is never
 * subscribed to and is dropped rather than parked if a relay volunteers one:
 * grimoire renders neither, and CORD-01 says relays must not store them.
 */
const WRAP_KINDS = new Set([KIND_WRAP]);

/**
 * Decode, store, and announce one relay's batch.
 *
 * Returns the ids of the wraps whose rumors are now DURABLY stored — which is
 * what the parked-wrap drain acks on, and the reason it is a return value rather
 * than a side effect. Anything absent from it either failed to open or failed to
 * write, and in both cases the wrap must stay parked.
 *
 * Never throws: this runs inside a socket loop, and a malformed wrap from one
 * relay must not tear down live delivery from the others.
 */
export async function ingestWireEvents(
  spec: WireSpec,
  events: NostrEvent[],
): Promise<Set<string>> {
  const stored = new Set<string>();
  if (events.length === 0) return stored;

  const byChannel = new Map<Channel, NostrEvent[]>();
  const controlWraps: NostrEvent[] = [];
  const toPark: NostrEvent[] = [];

  for (const event of events) {
    if (!event || typeof event.id !== "string") continue;
    if (!WRAP_KINDS.has(event.kind)) continue;
    const channel = spec.channelByPk.get(event.pubkey);
    if (channel) {
      const list = byChannel.get(channel);
      if (list) list.push(event);
      else byChannel.set(channel, [event]);
    } else if (spec.controlByPk.has(event.pubkey)) {
      controlWraps.push(event);
    } else {
      toPark.push(event);
    }
  }

  const scopes = new Set<WireScope>();
  await ingestChat(spec, byChannel, scopes, stored);
  await ingestControl(spec, controlWraps, scopes, stored);

  if (toPark.length > 0) {
    // A wrap for a stream we hold no key for: a rekey not caught up with, a
    // channel granted moments ago, a spec that has not refreshed. Ordinary, and
    // a standing subscription has no later chance to re-fetch it.
    void parkPendingWraps(toPark);
    for (const event of toPark) scopes.add(parkScope(event.pubkey));
  }

  if (scopes.size > 0) emitWireScopes(scopes);
  return stored;
}

async function ingestChat(
  spec: WireSpec,
  byChannel: Map<Channel, NostrEvent[]>,
  scopes: Set<WireScope>,
  stored: Set<string>,
): Promise<void> {
  for (const [channel, wraps] of byChannel) {
    try {
      const opened = await openChatBatch(wraps, channel);
      if (opened.length === 0) continue;
      // A channel reaches `channelByPk` through the same input that registered
      // its community, so a miss means the spec was rebuilt underneath us. Skip
      // rather than guess a tenant: the wraps are still on the relay, and
      // guessing would file one community's messages under another.
      const communityIdHex = spec.communityByChannel.get(channel.idHex);
      if (!communityIdHex) continue;
      const written = await writeChatRumors(
        communityIdHex,
        opened.map((ev) => ({ ...ev, channel: ev.channelIdHex })),
      );
      if (!written) continue;
      // `wrapId` is an envelope fact, present only while the wrap is in hand —
      // which it is here. A row without one simply never gets acked, and the
      // age prune is what eventually clears it.
      for (const ev of opened) if (ev.wrapId) stored.add(ev.wrapId);
      scopes.add(channelScope(channel.idHex));
    } catch (error) {
      console.warn("[concord] wire chat ingest failed:", error);
    }
  }
}

async function ingestControl(
  spec: WireSpec,
  wraps: NostrEvent[],
  scopes: Set<WireScope>,
  stored: Set<string>,
): Promise<void> {
  if (wraps.length === 0) return;

  const byCommunity = new Map<
    string,
    { target: WireControlTarget; wraps: NostrEvent[] }
  >();
  for (const event of wraps) {
    const target = spec.controlByPk.get(event.pubkey);
    if (!target) continue;
    const bucket = byCommunity.get(target.idHex);
    if (bucket) bucket.wraps.push(event);
    else byCommunity.set(target.idHex, { target, wraps: [event] });
  }

  for (const [idHex, { target, wraps: batch }] of byCommunity) {
    try {
      // The memo is shared with the sweep, so a wrap either transport already
      // processed costs nothing here — and a quiet rotation replays the overlap
      // window every time.
      const unseen = await unseenPlaneWraps(batch);
      if (unseen.length === 0) continue;
      const opened = await openPlaneWraps(unseen, target.groups);
      let written = true;
      if (opened.length > 0) {
        written = await writeOpened(idHex, opened, "control", {
          refounded: target.refounded,
        });
        if (written) {
          for (const ev of opened) stored.add(ev.wrapId);
          scopes.add(controlScope(idHex));
        }
      }
      // Record the junk BEFORE memoing it: the memo is what stops the sweep ever
      // re-attempting these, so this is the only chance to count them.
      const openedIds = new Set(opened.map((e) => e.wrapId));
      notePlaneWrapsJunk(
        unseen.filter((w) => !openedIds.has(w.id)).map((w) => w.id),
      );
      // Never memoed over a FAILED write: the memo is what stops these wraps
      // being decrypted again, so it must not outrun the store.
      if (written) notePlaneWrapsSeen(unseen.map((w) => w.id));
    } catch (error) {
      console.warn("[concord] wire control ingest failed:", error);
    }
  }
}

/**
 * Re-attempt every parked wrap whose stream address the current spec can now
 * open, and drop the ones that made it into the store.
 *
 * Called when the spec changes (a rekey adopted, a channel granted) and when a
 * `c2park:` scope rings. Ack ONLY after a durable write — see
 * `peekPendingWraps`.
 */
export async function drainParkedWraps(spec: WireSpec): Promise<void> {
  const held = [...spec.channelByPk.keys(), ...spec.controlByPk.keys()];
  if (held.length === 0) return;
  const parked = await peekPendingWraps(held);
  if (parked.length === 0) return;

  // Straight back through the same door, so a drained wrap takes exactly the
  // path a live one does — including both plane fences.
  const stored = await ingestWireEvents(spec, parked);

  // Ack ONLY what is durably stored. A wrap that failed to open, or opened and
  // failed to write, stays parked: the drain is retried on every spec change and
  // every `c2park:` ring, and the age prune is what eventually gives up. Acking
  // on "we hold a key for that address" instead would drop a message whose write
  // lost a race — the exact loss the peek/ack split exists to prevent.
  await ackPendingWraps(parked.map((w) => w.id).filter((id) => stored.has(id)));
}
