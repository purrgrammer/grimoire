/**
 * Concord disappearing messages — CORD-08.
 *
 * Adapted from armada `bc19d1f` (`src/concord/lib/disappearing.ts`, plus the
 * NIP-40 helpers it re-exports from `src/lib/nip17/protocol.ts`), read side
 * only: grimoire never sets a community's timer, so the staff mutation and the
 * kind-1740 notice broadcast are not ported. What IS ported is mandatory —
 * CORD-08 §3 obliges every reader to refuse an expired rumor at ingest, never
 * display one, and sweep them from local storage.
 *
 * The timer is COMMUNITY state, never a per-message choice: one
 * `message_expiration` field (seconds; absent/0 = off) in the vsk-0 metadata
 * entity. While set, every durable chat rumor carries a NIP-40 `expiration` of
 * its send time plus the timer, and the OUTER wrap carries the same tag so
 * relays purge the ciphertext itself (§2). Two chat kinds are exempt: deletes
 * (an expiring delete would let a longer-lived target come back) and the timer
 * notice itself (the notice documents the policy; the policy must not erase it).
 *
 * The tag rides inside the SIGNED rumor, so a timer change is never
 * retroactive and the tag as signed always governs — a reader honors what the
 * rumor says, not what the current fold prescribes.
 */

import { KIND_DELETE, KIND_TIMER_NOTICE } from "@/lib/concord/kinds";
import type { CommunityMetadata } from "@/lib/concord/types";

const DAY = 86_400;

/**
 * The community's timer in seconds, 0 = off. Absent, zero, or malformed reads
 * as OFF — a reader MUST NOT guess a default from garbage (CORD-08 §1) — so
 * this is the ONLY way the field should be read.
 */
export function messageExpirationOf(
  metadata: CommunityMetadata | undefined,
): number {
  const raw = metadata?.message_expiration;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return 0;
  return Math.floor(raw);
}

/** The chat kinds that MUST NOT expire (CORD-08 §2): deletes and timer notices. */
export const NEVER_EXPIRING_CHAT_KINDS: ReadonlySet<number> = new Set([
  KIND_DELETE,
  KIND_TIMER_NOTICE,
]);

/**
 * The NIP-40 deadline (unix seconds) carried by these tags, or undefined when
 * there is none. A malformed / non-finite value is treated as absent rather
 * than as "expired": a garbage tag must not be able to hide a message.
 *
 * Parsing is `Number()`-lenient, matching the reference implementation
 * exactly. Deliberately NOT the strict-decimal treatment `ms` and the edition
 * machinery get: there the two clients must agree on accept-vs-reject or they
 * diverge on ordering and on chain identity, whereas here a stricter reader
 * simply hides a message its peer shows — which is the divergence, not the
 * fix. Keep this identical to armada.
 */
export function expirationOf(tags: readonly string[][]): number | undefined {
  const raw = tags.find(([name]) => name === "expiration")?.[1];
  if (raw === undefined) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) ? secs : undefined;
}

/** Whether these tags carry a NIP-40 deadline that has already passed. */
export function isExpired(
  tags: readonly string[][],
  nowSecs: number = Math.floor(Date.now() / 1000),
): boolean {
  const at = expirationOf(tags);
  return at !== undefined && at <= nowSecs;
}

/**
 * The NIP-40 deadline an OUTGOING chat rumor of `kind`, sent at `sendMs`, must
 * carry under `timerSecs` — or undefined when it carries none (timer off, or an
 * exempt kind). The same value goes on the rumor and on its wrap (§2).
 */
export function chatExpiresAt(
  kind: number,
  sendMs: number,
  timerSecs: number,
): number | undefined {
  if (timerSecs <= 0 || NEVER_EXPIRING_CHAT_KINDS.has(kind)) return undefined;
  return Math.floor(sendMs / 1000) + timerSecs;
}

/**
 * The timer (seconds; 0 = off) a kind-1740 notice announces, or undefined when
 * the tag is missing or malformed — an unreadable notice must not be mistaken
 * for "turned it off". Same `["timer", "<seconds>"]` tag NIP-17 disappearing-DM
 * clients use.
 */
export function timerNoticeSeconds(rumor: {
  tags: readonly string[][];
}): number | undefined {
  const raw = rumor.tags.find(([name]) => name === "timer")?.[1];
  if (raw === undefined) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? Math.floor(secs) : undefined;
}

/** Labels for the durations armada's staff UI offers, for rendering a notice. */
const TIMER_LABELS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: DAY, label: "1 day" },
  { seconds: 7 * DAY, label: "1 week" },
  { seconds: 30 * DAY, label: "30 days" },
  { seconds: 90 * DAY, label: "90 days" },
  { seconds: 365 * DAY, label: "1 year" },
];

/**
 * A community timer in words. Prefers the preset labels above, so a timer set
 * in armada reads back the way it was chosen ("30 days", not "4 weeks 2 days"),
 * and falls back to a composed form for any other value.
 */
export function formatCommunityTimer(seconds: number): string {
  const preset = TIMER_LABELS.find((p) => p.seconds === seconds);
  if (preset) return preset.label;
  const days = Math.floor(seconds / DAY);
  if (days >= 1) return days === 1 ? "1 day" : `${days} days`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The in-timeline notice copy, phrased from the viewer's side. */
export function communityTimerNotice(
  seconds: number,
  byMe: boolean,
  name: string,
): string {
  const who = byMe ? "You" : name;
  if (seconds <= 0) return `${who} turned off disappearing messages.`;
  return `${who} set disappearing messages to ${formatCommunityTimer(seconds)}.`;
}
