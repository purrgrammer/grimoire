/**
 * How loudly a Concord channel is allowed to interrupt you.
 *
 * Armada's three-level Discord cascade, ported from `useNotifLevels.ts`
 * (`bc19d1f`): a channel, then its community, then the app-wide default, and
 * the first explicit answer wins. `all` rings for every message, `mentions`
 * only for one addressed to you, `nothing` for none — mentions included.
 *
 * **Local to this device, and to nobody's account in particular.** Armada syncs
 * these through an encrypted NIP-78 settings event; grimoire uploads nothing
 * but the messages you type, so a level set here stays here. The rows live in
 * `concordKv`, which is keyed by community rather than by account, so the
 * levels are the machine's and not the signed-in key's — and the logout wipe
 * clears that table whole, which means signing out forgets every level you set.
 * Both are deliberate: a mute is a preference about this screen, not a claim
 * about an identity, and a wipe that left it behind would leak which channels
 * someone cared enough about to silence. That behaviour is unchanged by the
 * keys becoming protocol-qualified: the family still sits in a table a Concord
 * logout empties whole, so a protocol that wants its levels to outlive one will
 * need a table of its own, not a different key.
 *
 * **The keys carry the protocol** ({@link containerLevelKey}) even though
 * Concord is the only writer, because the cascade's two rungs are a container
 * and a channel — the same two rungs a NIP-29 relay and group would need — and
 * a container id only means anything alongside the protocol that issued it.
 *
 * Reads are SYNCHRONOUS against a memo, because the callers are a context menu
 * painting a checkmark and a notifier deciding inside a bus flush. {@link
 * ensureNotifPrefsLoaded} is what fills it — one prefixed range read for the
 * whole family — and {@link resolveLevel} is the async door that awaits it for
 * callers with nowhere to put a loading state.
 */

import { settingsManager } from "@/services/settings";
import db from "@/services/db";
import type { ChatProtocol } from "@/types/chat";

/** All, only when named, or never. Absent at a scope means "inherit". */
export type NotifLevel = "all" | "mentions" | "nothing";

const KEY_PREFIX = "chatnotif:";

/**
 * The field separator inside a level key.
 *
 * `|` rather than the `::` this family shipped with, because the container
 * segment is only a bare hex id while Concord is the only protocol. A NIP-29
 * container is a relay URL, and `wss://[::1]/` puts `::` inside the segment —
 * which would make `container::channel` ambiguous with a container that merely
 * contains a colon pair. `|` cannot appear unescaped in a URL and cannot appear
 * in hex, so it stays a separator whatever occupies the fields.
 */
const SEP = "|";

/** Which protocol the functions below write levels for. */
const PROTOCOL: ChatProtocol = "concord";

/**
 * The kv key for a whole container's explicit level.
 *
 * PROTOCOL-QUALIFIED, because a container id is only unique within a protocol:
 * a Concord community id is a global commitment, a NIP-29 relay URL is not, and
 * nothing but this segment would keep the two families apart in one flat table.
 */
export const containerLevelKey = (
  protocol: ChatProtocol,
  containerId: string,
): string => `${KEY_PREFIX}${protocol}${SEP}${containerId.toLowerCase()}`;

/** The kv key for one channel's explicit level, inside its container. */
export const channelLevelKey = (
  protocol: ChatProtocol,
  containerId: string,
  channelIdHex: string,
): string =>
  `${containerLevelKey(protocol, containerId)}${SEP}${channelIdHex.toLowerCase()}`;

/** Every explicit level this device holds, by kv key. Sync answers come here. */
const memo = new Map<string, NotifLevel>();
/** One load per session, shared by every caller that races for it. */
let loading: Promise<void> | undefined;
let loaded = false;

const listeners = new Set<() => void>();

function isLevel(value: unknown): value is NotifLevel {
  return value === "all" || value === "mentions" || value === "nothing";
}

/**
 * Fill the memo from `concordKv`, once.
 *
 * Fail-soft: a storage error leaves the memo empty, which reads as "everything
 * inherits the global default" — the state a fresh install is in anyway.
 */
export async function ensureNotifPrefsLoaded(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const rows = await db.concordKv
        .where("key")
        .startsWith(KEY_PREFIX)
        .toArray();
      for (const row of rows) {
        if (isLevel(row.value)) memo.set(row.key, row.value);
      }
    } catch (error) {
      console.warn("[concord] could not read notification levels:", error);
    }
    loaded = true;
    loading = undefined;
  })();
  return loading;
}

/** The level explicitly set on this channel, or undefined — it inherits. */
export function channelLevelOverride(
  communityId: string,
  channelIdHex: string,
): NotifLevel | undefined {
  return memo.get(channelLevelKey(PROTOCOL, communityId, channelIdHex));
}

/** The level explicitly set on this community, or undefined — it inherits. */
export function communityLevelOverride(
  communityId: string,
): NotifLevel | undefined {
  return memo.get(containerLevelKey(PROTOCOL, communityId));
}

/** The app-wide fallback: what a channel nobody has touched is worth. */
export function defaultLevel(): NotifLevel {
  const stored = settingsManager.value.notifications?.defaultLevel;
  return isLevel(stored) ? stored : "mentions";
}

/**
 * The cascade: this channel, else its community, else the global default.
 *
 * Synchronous, so it is only as current as the memo — call it after
 * {@link ensureNotifPrefsLoaded} or through {@link resolveLevel}, which does.
 */
export function resolveLevelSync(
  communityId: string,
  channelIdHex: string,
): NotifLevel {
  return (
    channelLevelOverride(communityId, channelIdHex) ??
    communityLevelOverride(communityId) ??
    defaultLevel()
  );
}

/**
 * What a scope would fall back to if its OWN level were cleared.
 *
 * The cascade with this rung removed, which is what the "Use community
 * default (…)" entry has to name: while an override is set, the resolved level
 * IS the override, so labelling that entry with it promises the level the click
 * would leave — the one control whose whole job is not losing a mention.
 *
 * Omit the channel for a community's own fallback: the app default.
 */
export function inheritedLevelSync(
  communityId: string,
  channelIdHex?: string,
): NotifLevel {
  if (!channelIdHex) return defaultLevel();
  return communityLevelOverride(communityId) ?? defaultLevel();
}

/** {@link resolveLevelSync}, having waited for the store. */
export async function resolveLevel(
  communityId: string,
  channelIdHex: string,
): Promise<NotifLevel> {
  await ensureNotifPrefsLoaded();
  return resolveLevelSync(communityId, channelIdHex);
}

/** Tell every mounted menu the memo moved under it. */
function ring(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One stale subscriber must not stop the others from repainting.
    }
  }
}

async function writeLevel(
  key: string,
  level: NotifLevel | undefined,
): Promise<void> {
  // The memo moves first: the menu that just set a level re-renders from it,
  // and a Dexie write that fails must not leave the screen contradicting the
  // click. The row is the durable copy, not the authority for this session.
  if (level === undefined) memo.delete(key);
  else memo.set(key, level);
  ring();
  try {
    if (level === undefined) await db.concordKv.delete(key);
    else await db.concordKv.put({ key, value: level });
  } catch (error) {
    console.warn("[concord] could not store a notification level:", error);
  }
}

/** Set — or with `undefined`, clear back to inherited — one channel's level. */
export function setChannelLevel(
  communityId: string,
  channelIdHex: string,
  level: NotifLevel | undefined,
): Promise<void> {
  return writeLevel(
    channelLevelKey(PROTOCOL, communityId, channelIdHex),
    level,
  );
}

/** Set — or clear — the level every channel of one community inherits. */
export function setCommunityLevel(
  communityId: string,
  level: NotifLevel | undefined,
): Promise<void> {
  return writeLevel(containerLevelKey(PROTOCOL, communityId), level);
}

/** Repaint on a level change, from anywhere in the app. Returns unsubscribe. */
export function onNotifPrefsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether a resolved level lets this message through.
 *
 * `mention` here is what `mentionsPubkey` (`src/lib/chat/mentions.ts`)
 * answers, which includes a threaded reply to you — a reply is addressed to you
 * whether or not it spells your name. Armada draws the same line.
 */
export function levelAdmits(level: NotifLevel, mention: boolean): boolean {
  if (level === "nothing") return false;
  if (level === "mentions") return mention;
  return true;
}

/**
 * Forget every level held in memory.
 *
 * The logout door. The rows themselves go with `db.concordKv.clear()`, so
 * without this the running tab would keep answering from a memo whose backing
 * table is empty — and the levels would reappear for whoever signs in next.
 *
 * Rings the listeners like a write does: logout happens with the sidebar still
 * mounted, and a menu that is not told keeps painting the checkmark of a level
 * that no longer exists until something unrelated re-renders it.
 */
export function resetNotifPrefsMemory(): void {
  memo.clear();
  loaded = false;
  loading = undefined;
  ring();
}

/** Test seam: forget the levels in memory AND the rows behind them. */
export async function _resetNotifPrefsForTests(): Promise<void> {
  resetNotifPrefsMemory();
  listeners.clear();
  await db.concordKv.where("key").startsWith(KEY_PREFIX).delete();
}
