/**
 * Whether a freshly ingested Concord message is worth interrupting someone for.
 *
 * All the judgement, none of the plumbing: the hook above this resolves ids to
 * names and calls `new Notification`, and everything that could be gotten WRONG
 * lives here where a test can drive it. Ported from armada's
 * `useForegroundNotifications.ts` (`bc19d1f`), whose gate order this keeps.
 *
 * Two pieces of module state, both of which exist because a Concord window is
 * not the only one:
 *
 * - the ACTIVE-CHANNEL registry, refcounted, so two windows looking at the same
 *   channel both have to look away before it can alert — and so one window
 *   closing does not un-silence the channel the other is still reading;
 * - the DEDUPE ring, so the same rumor arriving twice (a re-ingest, a second
 *   window's wire, a catch-up replay overlapping live delivery) alerts once.
 *
 * The session floor is the other half of that last point and belongs to the
 * caller, because it is per-mount: history written by a backfill is ingested
 * exactly like a live message, and without a floor at "when this session
 * started" the first sync after a week away would fire a week of alerts.
 */

import { levelAdmits, type NotifLevel } from "@/services/concord-notif-prefs";

/** What a candidate row amounts to, once the store row has been read. */
export interface NotifyCandidate {
  rumorId: string;
  author: string;
  createdAt: number;
  /** Addressed to the reader — a `p` tag, which a threaded reply also carries. */
  isMention: boolean;
  channelIdHex: string;
}

/** Everything outside the row that decides its fate. */
export interface NotifyContext {
  /** The user asked for notifications at all (Settings). */
  enabled: boolean;
  /** The browser agreed (`Notification.permission === "granted"`). */
  permissionGranted: boolean;
  /** Seconds; a row at or below this predates the session and is history. */
  sessionFloor: number;
  selfPubkey: string;
  /** The resolved cascade level for this channel. */
  level: NotifLevel;
  /** The reader's last-read stamp for this channel, in seconds. */
  lastRead: number;
  /** Whether this document is on screen right now. */
  visible: boolean;
}

/** Channel id → how many mounted windows have it open. */
const active = new Map<string, number>();

/** This window is now looking at this channel. */
export function registerActiveChannel(channelIdHex: string): void {
  const id = channelIdHex.toLowerCase();
  if (!id) return;
  active.set(id, (active.get(id) ?? 0) + 1);
}

/** This window has looked away. Refcounted — the last one out clears it. */
export function unregisterActiveChannel(channelIdHex: string): void {
  const id = channelIdHex.toLowerCase();
  const count = active.get(id);
  if (count === undefined) return;
  if (count <= 1) active.delete(id);
  else active.set(id, count - 1);
}

/** Whether any window in this tab has this channel open. */
export function isChannelActive(channelIdHex: string): boolean {
  return active.has(channelIdHex.toLowerCase());
}

/**
 * The rumor ids already surfaced, oldest first.
 *
 * A ring rather than an unbounded set: this grows with every message the tab
 * ever sees, and a tab can be left open for weeks.
 */
const notified = new Set<string>();
const NOTIFIED_LIMIT = 500;

function remember(rumorId: string): void {
  notified.add(rumorId);
  if (notified.size <= NOTIFIED_LIMIT) return;
  // Insertion order is age order, so the first key is the oldest.
  const oldest = notified.values().next();
  if (!oldest.done) notified.delete(oldest.value);
}

/**
 * Should this message raise a desktop notification?
 *
 * **Asking is answering**: a candidate that passes every gate is recorded as
 * notified before this returns, so calling it twice for the same rumor is the
 * dedupe case rather than a double alert. That is the one impurity, and it is
 * here rather than in the caller because a caller that forgot to record would
 * fail silently and loudly at the same time.
 *
 * The order matters and is armada's:
 *
 * 1. the user wants notifications, and the browser agreed;
 * 2. the row is newer than this session — a backfill is not news;
 * 3. it is not the reader's own message;
 * 4. the channel's level admits it (`mentions` needs a `p` tag);
 * 5. the reader has not already read past it;
 * 6. they are not looking at that channel in a visible window right now;
 * 7. it has not already been surfaced.
 */
export function shouldNotify(
  candidate: NotifyCandidate,
  context: NotifyContext,
): boolean {
  if (!context.enabled) return false;
  if (!context.permissionGranted) return false;
  if (candidate.createdAt <= context.sessionFloor) return false;
  if (candidate.author && candidate.author === context.selfPubkey) return false;
  if (!levelAdmits(context.level, candidate.isMention)) return false;
  if (candidate.createdAt <= context.lastRead) return false;
  if (context.visible && isChannelActive(candidate.channelIdHex)) return false;
  if (notified.has(candidate.rumorId)) return false;
  remember(candidate.rumorId);
  return true;
}

/**
 * A message as an OS notification can show it: plain text, one line.
 *
 * The timeline runs content through `RichText`, which turns a `nostr:` URI into
 * a name and a `:shortcode:` into an image. A notification has neither, so
 * without this a mention reads as sixty characters of bech32 and the message
 * itself never fits. Placeholders rather than names: resolving a pubkey is
 * asynchronous and this has to answer while the alert is being built.
 *
 * The shortcode pattern is deliberately anchored to word edges — `10:30:45` is
 * not two emoji — and the trim is last, so what is cut is the reader's prose
 * rather than a URI that was about to disappear anyway.
 */
export function notificationBody(content: string, limit: number): string {
  const text = content
    .replace(
      /\bnostr:(?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+/gi,
      "@someone",
    )
    .replace(
      /\bnostr:(?:note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/gi,
      "[note]",
    )
    .replace(/(^|\s):([a-z0-9_+-]{2,30}):(?=$|[\s.,!?])/gi, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

/**
 * Forget what this tab has already announced. The logout door.
 *
 * The ring holds rumor ids belonging to the account that just left, and every
 * other Concord memo is emptied there — `clearCommunities` in
 * `src/services/concord-communities.ts` is where this is called from.
 *
 * The ACTIVE-CHANNEL registry deliberately stays. It mirrors which windows are
 * mounted right now, not who is signed in: clearing it would tell the next ring
 * that nobody is looking at the channel that is still on screen, which is the
 * one case this file exists to suppress. Those entries leave when their windows
 * unmount, which is the only thing that knows.
 */
export function resetAnnouncedMemory(): void {
  notified.clear();
}

/** Test seam: forget which channels are open and what has been announced. */
export function _resetNotifyForTests(): void {
  active.clear();
  notified.clear();
}
