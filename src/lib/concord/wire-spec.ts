/**
 * What the wire holds open, as plain data.
 *
 * Ported from armada `bc19d1f` (`src/wire/spec.ts`), narrowed to Concord —
 * armada's version also carries NIP-29, NIP-17 DMs, Buzz and NIP-34 git, none of
 * which belongs here.
 *
 * Kept pure on purpose. The interesting decisions below are all about WHICH
 * addresses go in a filter, and that is exactly the kind of thing that is
 * miserable to test through a socket and trivial to test as a function.
 *
 * Two author sets, both `{kinds: [1059], authors: [...]}`, scoped differently
 * and for different reasons. See {@link buildWireSpec}.
 */

import { KIND_WRAP } from "@/lib/concord/kinds";
import type { StreamKeyView } from "@/lib/concord/derive";
import type { Channel } from "@/lib/concord/types";
import { normalizeRelayURL } from "@/lib/relay-url";
import type { Filter } from "nostr-tools";

/** One channel the member can read, and where to listen for it. */
export interface WireChannelInput {
  relays: string[];
  channel: Channel;
  communityIdHex: string;
}

/** One community's Control Plane, and where to listen for it. */
export interface WireControlInput {
  relays: string[];
  idHex: string;
  /** The CURRENT epoch's plane — the address anything live is published at. */
  current: StreamKeyView;
  /** Every held epoch, for DECODING a straggler or a parked wrap. */
  groups: StreamKeyView[];
  /** Whether the community has ever Refounded (drives snapshot recording). */
  refounded: boolean;
}

export interface WireInputs {
  channels: WireChannelInput[];
  control: WireControlInput[];
}

/** One relay's standing subscription. */
export interface WireSub {
  relay: string;
  filters: Filter[];
}

/** What a control wrap needs at ingest, once demuxed by author. */
export interface WireControlTarget {
  idHex: string;
  groups: StreamKeyView[];
  refounded: boolean;
}

export interface WireSpec {
  subs: WireSub[];
  /** Chat stream address → the channel that owns it. EVERY held epoch. */
  channelByPk: Map<string, Channel>;
  /** Channel id hex → its community id hex, so a rumor is filed correctly. */
  communityByChannel: Map<string, string>;
  /** Control stream address → its community. EVERY held epoch. */
  controlByPk: Map<string, WireControlTarget>;
  /** Deterministic signature of `subs`, for the per-relay diff. */
  sig: string;
}

function safeNormalize(url: string): string | undefined {
  try {
    return normalizeRelayURL(url);
  } catch {
    return undefined;
  }
}

/**
 * Build the per-relay subscription spec.
 *
 * **Chat: the CURRENT epoch only.** Armada's reason, ported verbatim in intent —
 * a retired epoch is sealed history with a hard read cutoff (its rotation's
 * publish time), so nothing legitimate ever arrives there live. Holding every
 * old address open forever is a permanent writable side-channel for any ejected
 * keyholder, plus unbounded filter growth. History reaches the store through
 * `syncChannel`, not here.
 *
 * **Control: the CURRENT epoch only too** — a narrowing from armada, which
 * subscribes to every held control epoch. The same argument applies and nothing
 * is lost by it: after a Refounding, staff publish at the NEW address, and the
 * compaction snapshot the fold anchors on is published there as well. It also
 * keeps the wire consistent with grimoire's own sweep, which has read
 * current-only since phase 3 because the plane is compaction-bounded.
 *
 * **Both decode maps keep EVERY held epoch.** The filter decides what is asked
 * for; the map decides what can be opened. A wrap already in flight when a
 * rotation lands, or one drained from the park later, still decodes — and the
 * decode path enforces the read cutoff either way, so widening the map cannot
 * widen what is accepted.
 *
 * Filters for the two author sets are kept separate rather than merged: control
 * wraps decode with different keys and wake the fold rather than a timeline. On
 * a relay carrying both, that is two REQs where one would do — the cost of one
 * extra filter frame, against a demux that would otherwise have to guess.
 */
export function buildWireSpec(inputs: WireInputs): WireSpec {
  const byRelay = new Map<string, Filter[]>();
  const add = (url: string, filter: Filter) => {
    const relay = safeNormalize(url);
    if (!relay) return;
    const list = byRelay.get(relay);
    if (list) list.push(filter);
    else byRelay.set(relay, [filter]);
  };

  // ── Chat ───────────────────────────────────────────────────────────────────
  const channelByPk = new Map<string, Channel>();
  const communityByChannel = new Map<string, string>();
  const chatPksByRelay = new Map<string, Set<string>>();
  for (const { relays, channel, communityIdHex } of inputs.channels) {
    for (const stream of channel.streams) {
      channelByPk.set(stream.group.pk, channel);
    }
    communityByChannel.set(channel.idHex, communityIdHex);
    for (const url of relays) {
      const relay = safeNormalize(url);
      if (!relay) continue;
      let set = chatPksByRelay.get(relay);
      if (!set) chatPksByRelay.set(relay, (set = new Set()));
      set.add(channel.current.group.pk);
    }
  }
  for (const [relay, pks] of chatPksByRelay) {
    add(relay, { kinds: [KIND_WRAP], authors: [...pks].sort() });
  }

  // ── Control ────────────────────────────────────────────────────────────────
  const controlByPk = new Map<string, WireControlTarget>();
  const ctlPksByRelay = new Map<string, Set<string>>();
  for (const { relays, idHex, current, groups, refounded } of inputs.control) {
    const target: WireControlTarget = { idHex, groups, refounded };
    for (const group of groups) controlByPk.set(group.pk, target);
    // The current address may be absent from `groups` if a caller passes a
    // partial held set; register it either way, or a live edition arrives and
    // has nothing to decode it.
    controlByPk.set(current.pk, target);
    for (const url of relays) {
      const relay = safeNormalize(url);
      if (!relay) continue;
      let set = ctlPksByRelay.get(relay);
      if (!set) ctlPksByRelay.set(relay, (set = new Set()));
      set.add(current.pk);
    }
  }
  for (const [relay, pks] of ctlPksByRelay) {
    add(relay, { kinds: [KIND_WRAP], authors: [...pks].sort() });
  }

  const subs: WireSub[] = [...byRelay.entries()]
    .map(([relay, filters]) => ({ relay, filters }))
    .sort((a, b) => (a.relay < b.relay ? -1 : 1));

  return {
    subs,
    channelByPk,
    communityByChannel,
    controlByPk,
    sig: JSON.stringify(subs),
  };
}

/** The filter signature for one relay, for the per-relay restart diff. */
export const subSignature = (filters: Filter[]): string =>
  JSON.stringify(filters);
