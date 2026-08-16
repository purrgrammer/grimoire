/**
 * The runtime channel view — the Control fold plus the keys the member holds.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/community.ts` `channelsView`,
 * `channelOrder.ts`, `channelCategory.ts`), minus every write path and minus
 * voice (CORD-07 is out of scope, so no channel derives call coordinates).
 *
 * Ordering and grouping are ARMADA CLIENT CONVENTIONS, not protocol: CORD-03
 * gives a Channel neither an ordering field nor any notion of grouping, so both
 * ride in `custom` (`armada.order`, `armada.category`) and are advisory display
 * data. A client that ignores them loses the arrangement, never a channel — and
 * grimoire honours them so a community's sidebar looks the same in both clients.
 */

import { bytesToHex, channelGroupKey, hex32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import {
  NAME_MAX_BYTES,
  utf8Len,
  type Channel,
  type ChannelMetadata,
  type Community,
} from "@/lib/concord/types";

export const ARMADA_CHANNEL_ORDER_METADATA_KEY = "armada.order";
export const ARMADA_CHANNEL_CATEGORY_METADATA_KEY = "armada.category";

/** Sorts after every positioned channel, without claiming a real position. */
export const UNPOSITIONED = Number.MAX_SAFE_INTEGER;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The channel's sidebar position, or undefined when it carries none. */
export function channelPosition(metadata: ChannelMetadata): number | undefined {
  const extension = isRecord(metadata.custom)
    ? metadata.custom[ARMADA_CHANNEL_ORDER_METADATA_KEY]
    : undefined;
  if (!isRecord(extension)) return undefined;
  const position = extension.position;
  if (
    typeof position !== "number" ||
    !Number.isSafeInteger(position) ||
    position < 0
  ) {
    return undefined;
  }
  return position;
}

/**
 * The channel's category name, or undefined when it belongs to none. Bounded by
 * the same 64 bytes as every other name (CORD-02 §6); an over-long or blank one
 * reads as uncategorized rather than invalidating the channel.
 */
export function channelCategory(metadata: ChannelMetadata): string | undefined {
  const extension = isRecord(metadata.custom)
    ? metadata.custom[ARMADA_CHANNEL_CATEGORY_METADATA_KEY]
    : undefined;
  if (!isRecord(extension) || typeof extension.name !== "string") {
    return undefined;
  }
  const name = extension.name.trim();
  if (!name || utf8Len(name) > NAME_MAX_BYTES) return undefined;
  return name;
}

/** Group identity: "Voice" and "voice" are one category, not two near-duplicates. */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The display comparator: position first, then name — one order on every client. */
export function compareChannelOrder(
  a: { position?: number; name: string },
  b: { position?: number; name: string },
): number {
  const pa = a.position ?? UNPOSITIONED;
  const pb = b.position ?? UNPOSITIONED;
  return pa - pb || a.name.localeCompare(b.name);
}

/** One rendered group: a heading (or the uncategorized run) and its channels. */
export interface ChannelCategory<T> {
  /** Casefolded identity; empty string for the uncategorized run. */
  key: string;
  /** The spelling to display, taken from the first channel in the group. */
  name: string;
  channels: T[];
}

/**
 * Partition channels (ALREADY in display order) into the uncategorized run
 * followed by the categories.
 *
 * A category is EMERGENT, not an entity: it exists exactly as long as some
 * visible Channel names it. So there is no category list to create, delete or
 * garbage-collect, no way to have a category pointing at a channel that no
 * longer exists, and — since a private channel whose key the member lacks is
 * already omitted — no way for the sidebar to show a heading whose contents are
 * all hidden.
 *
 * Input order does all the work: within a category the channels keep it, and the
 * categories appear in order of their first channel. A category's position is
 * therefore READ OFF its first member rather than settable, so ordering the
 * channels orders the categories too, with no second arrangement to maintain.
 */
export function groupChannelsByCategory<T extends { name: string }>(
  channels: readonly T[],
  categoryOf: (channel: T) => string | undefined,
): { uncategorized: T[]; categories: ChannelCategory<T>[] } {
  const uncategorized: T[] = [];
  const categories: ChannelCategory<T>[] = [];
  const byKey = new Map<string, ChannelCategory<T>>();

  for (const channel of channels) {
    const name = categoryOf(channel)?.trim();
    if (!name) {
      uncategorized.push(channel);
      continue;
    }
    const key = categoryKey(name);
    let group = byKey.get(key);
    if (!group) {
      group = { key, name, channels: [] };
      byKey.set(key, group);
      categories.push(group);
    }
    group.channels.push(channel);
  }

  return { uncategorized, categories };
}

/**
 * Split the pinned channels off the front, both runs keeping display order.
 *
 * A pinned channel leaves its category, which means it escapes a folded one —
 * intended: pinning says "always where I can see it", and a pin that could be
 * folded away would be two arrangements arguing.
 *
 * Grimoire-original. Armada pins messages and direct messages, never channels,
 * so nothing here claims cross-client parity — a pin is invisible to armada and
 * armada's arrangement is unaffected by one.
 */
export function partitionPinned<T>(
  channels: readonly T[],
  isPinned: (channel: T) => boolean,
): { pinned: T[]; rest: T[] } {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const channel of channels)
    (isPinned(channel) ? pinned : rest).push(channel);
  return { pinned, rest };
}

/**
 * Which channel a sidebar should have open: the explicit pick, else the one this
 * device was last left on, else the first the member can read.
 *
 * Fully derived, so nothing writes state during a render pass and the pane fills
 * the moment the fold lands. Only an explicit pick is ever REMEMBERED — a
 * fallback resolution that persisted itself would record the first channel of a
 * community whose fold had not arrived yet as the one the reader chose.
 */
export function resolveOpenChannel<T extends { idHex: string }>(
  channels: readonly T[],
  explicitIdHex: string | undefined,
  rememberedIdHex?: string,
): T | undefined {
  const at = (wanted: string | undefined): T | undefined =>
    wanted
      ? channels.find((ch) => ch.idHex.toLowerCase() === wanted.toLowerCase())
      : undefined;
  return at(explicitIdHex) ?? at(rememberedIdHex) ?? channels[0];
}

/**
 * Assemble the channels the member can actually read, from the Control fold plus
 * the keys they hold:
 *
 * - a PUBLIC channel derives its stream from the community_root per held root
 *   epoch — readable by every member, and it rotates with the base for free;
 * - a PRIVATE channel needs its independent key from the member's join material;
 *   lacking it the channel is omitted rather than teased, since its ciphertext
 *   is unreadable anyway;
 * - a DELETED channel is dropped from display (CORD-03 §2: deletion is
 *   terminal). History stays decryptable to whoever held the keys.
 */
export function channelsView(
  community: Community,
  folded: FoldedControl | undefined,
): Channel[] {
  const out: Channel[] = [];
  const seen = new Set<string>();
  const privateKeysById = new Map(
    community.privateChannels.map((ch) => [bytesToHex(ch.id), ch]),
  );

  for (const def of folded?.channels.values() ?? []) {
    // A folded definition is authoritative even when it is a tombstone. Mark it
    // seen BEFORE dropping deleted channels, so the held-key fallback below
    // cannot resurrect a deleted Private Channel as merely "not yet folded".
    seen.add(def.channelIdHex);
    if (def.deleted) continue;
    const id = hex32(def.channelIdHex);

    // History is not one key. A channel accumulates streams: one per held ROOT
    // epoch (what it wrote while public) and one per held CHANNEL key, current
    // and retained priors (what it wrote under each private epoch). Rendering
    // only the current one is why converting a channel — or simply rotating its
    // key — appeared to erase the conversation.
    const rootStreams = community.heldRoots.map((r) => ({
      epoch: r.epoch,
      group: channelGroupKey(r.key, id, r.epoch),
      ...(r.retiredAt !== undefined ? { retiredAt: r.retiredAt } : {}),
    }));
    const held = privateKeysById.get(def.channelIdHex);
    const channelStreams = held
      ? [
          {
            epoch: held.epoch,
            group: channelGroupKey(held.key, id, held.epoch),
          },
          ...(held.priors ?? []).map((p) => ({
            epoch: p.epoch,
            group: channelGroupKey(p.key, id, p.epoch),
            ...(p.retiredAt !== undefined ? { retiredAt: p.retiredAt } : {}),
          })),
        ]
      : [];

    if (!def.isPrivate) {
      out.push({
        id,
        idHex: def.channelIdHex,
        name: def.name,
        isPrivate: false,
        category: channelCategory(def.metadata),
        position: channelPosition(def.metadata),
        // Writes go to the root stream; private-era streams stay readable.
        streams: [...rootStreams, ...channelStreams],
        current: rootStreams[0],
      });
      continue;
    }

    if (!held) continue; // no key → cannot read; omit rather than tease
    out.push({
      id,
      idHex: def.channelIdHex,
      name: def.name,
      isPrivate: true,
      category: channelCategory(def.metadata),
      position: channelPosition(def.metadata),
      // A Private Channel reads ONLY its channel-key streams — the current key
      // and every retained prior — so a rotation never erases the conversation.
      // It deliberately does NOT fold in the root-derived stream every public
      // channel shares: those messages are world-readable to the whole
      // membership, so surfacing them inside a private channel would present
      // public content as private. Publicising re-folds the root stream via the
      // public branch above; the pre-conversion history is never lost, only
      // absent from the private view.
      streams: channelStreams,
      current: channelStreams[0],
    });
  }

  // Private channels held in the join material but not yet folded from the
  // Control Plane still render — the fold may lag a fresh join. The fold's name
  // wins once it lands.
  for (const held of community.privateChannels) {
    const idHex = bytesToHex(held.id);
    if (seen.has(idHex)) continue;
    const stream = {
      epoch: held.epoch,
      group: channelGroupKey(held.key, held.id, held.epoch),
    };
    const priorStreams = (held.priors ?? []).map((p) => ({
      epoch: p.epoch,
      group: channelGroupKey(p.key, held.id, p.epoch),
      ...(p.retiredAt !== undefined ? { retiredAt: p.retiredAt } : {}),
    }));
    out.push({
      id: held.id,
      idHex,
      name: held.name || idHex.slice(0, 8),
      isPrivate: true,
      streams: [stream, ...priorStreams],
      current: stream,
    });
  }

  return out.sort(compareChannelOrder);
}
