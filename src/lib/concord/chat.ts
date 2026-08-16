/**
 * Chat Plane decode and timeline fold (CORD-03).
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/chat.ts`), read half only.
 *
 * Narrowed on purpose. Armada's fold additionally handles zaps, polls, poll
 * votes, calendar events, RSVPs, WebXDC and its flood/pause display heuristics;
 * none of that is ported. The kinds that carry standalone CONTENT (polls,
 * calendar events) still land in the timeline pool so grimoire's kind registry
 * renders them rather than dropping them silently. The kinds that are SIDE
 * events referencing another rumor (votes, RSVPs, zap receipts) are skipped: a
 * vote has no meaning as a timeline row, and rendering one would be worse than
 * omitting it.
 *
 * What is NOT narrowed, and must not be: the decode gate (encrypted seal,
 * channel binding, retired-epoch cutoff), banned-author dropping, the CORD-08
 * expiry refusal, the edit rule, and the in-batch delete pass.
 */

import {
  citationFromTags,
  type AuthorityCitation,
} from "@/lib/concord/edition";
import { citationSatisfied, type FoldedControl } from "@/lib/concord/control";
import { isExpired, timerNoticeSeconds } from "@/lib/concord/disappearing";
import { canActOnMember, isAuthorized, Permissions } from "@/lib/concord/roles";
import {
  KIND_CALENDAR_DATE,
  KIND_CALENDAR_TIME,
  KIND_COMMENT,
  KIND_DELETE,
  KIND_EDIT,
  KIND_MESSAGE,
  KIND_POLL,
  KIND_REACTION,
  KIND_SEAL_ENCRYPTED,
  KIND_TIMER_NOTICE,
} from "@/lib/concord/kinds";
import type { NostrRumor } from "@/lib/concord/rumor";
import {
  checkChannelBinding,
  openWrap,
  type OpenedEvent,
} from "@/lib/concord/stream";
import type { Channel } from "@/lib/concord/types";

/** An opened chat event with its VERIFIED channel/epoch coordinate. */
export interface OpenedChat extends OpenedEvent {
  channelIdHex: string;
  epoch: bigint;
}

// ── Decode-once cache ────────────────────────────────────────────────────────

/**
 * `wrapId|channelIdHex` → opened, or null for a remembered failure.
 *
 * Keyed PER CHANNEL so one channel's "not my key" cannot poison another's
 * decode of the same wrap id.
 */
const decodeMemo = new Map<string, OpenedChat | null>();

/** Memo keys that failed as "no held stream key" — retryable after a rekey. */
const skippedNoKey = new Set<string>();

/** Forget remembered no-key failures (a caught-up rekey may now decode them). */
export function forgetChatSkips(): void {
  for (const id of skippedNoKey) decodeMemo.delete(id);
  skippedNoKey.clear();
}

/** Test seam: forget every decode, including successes. */
export function _resetChatDecodeForTests(): void {
  decodeMemo.clear();
  skippedNoKey.clear();
  deletedReactionIds.clear();
}

function openOne(wrap: NostrRumor, channel: Channel): OpenedChat | null {
  const memoKey = `${wrap.id}|${channel.idHex}`;
  const cached = decodeMemo.get(memoKey);
  if (cached !== undefined) return cached;

  const stream = channel.streams.find((s) => s.group.pk === wrap.pubkey);
  if (!stream) {
    // Remembered as RETRYABLE: a rekey we have not caught up with yet may hand
    // us the key later, and a permanent "no" would keep the history dark.
    decodeMemo.set(memoKey, null);
    skippedNoKey.add(memoKey);
    return null;
  }
  let opened: OpenedChat | null;
  try {
    const ev = openWrap(wrap, stream.group);
    // Chat seals MUST be encrypted (CORD-02 §5). A plaintext seal would make
    // the message a standalone signed artifact any relay could display.
    if (ev.sealKind !== KIND_SEAL_ENCRYPTED) {
      throw new Error("chat seal must be encrypted");
    }
    checkChannelBinding(ev, channel.idHex, stream.epoch);
    // A retired epoch is sealed history, not a live channel: the superseding
    // rotation's publish time is a hard cutoff, and anything sealed under the
    // old key but dated after it is refused. Key possession alone must not keep
    // an ejected member writing into epochs the community rotated away from —
    // the roster and banlist cannot drop what they cannot attribute in time.
    if (stream.retiredAt !== undefined && ev.createdAt > stream.retiredAt) {
      throw new Error("sealed under a retired epoch after its rotation");
    }
    opened = { ...ev, channelIdHex: channel.idHex, epoch: stream.epoch };
  } catch {
    opened = null;
  }
  decodeMemo.set(memoKey, opened);
  return opened;
}

/**
 * Drop stored events that violate their epoch's retirement cutoff.
 *
 * {@link openOne} refuses these at ingest, but rows written before the rotation
 * was adopted locally — or by a client that predates cutoffs — are already in
 * the store, so the READ side applies the same rule. A retired epoch has to be
 * history everywhere, not just for freshly-arriving wraps.
 */
export function filterEpochCutoff(
  events: OpenedChat[],
  channel: Channel,
): OpenedChat[] {
  let cutoffs: Map<string, number> | undefined;
  for (const s of channel.streams) {
    if (s.retiredAt === undefined) continue;
    (cutoffs ??= new Map()).set(s.epoch.toString(), s.retiredAt);
  }
  if (!cutoffs) return events;
  const caps = cutoffs;
  return events.filter((ev) => {
    const cap = caps.get(ev.epoch.toString());
    return cap === undefined || ev.createdAt <= cap;
  });
}

/**
 * Max unbroken main-thread time (ms) spent decoding before yielding.
 *
 * Time-based rather than a fixed wrap count, so a slow phone yields sooner than
 * a fast desktop instead of both blocking for a fixed number of Schnorr
 * verifies. Kept well under 16ms so the input pipeline has room between slices.
 */
const DECODE_SLICE_MS = 5;

/**
 * Open a batch of sealed wraps for one channel, memoized and time-sliced.
 *
 * Each wrap costs two synchronous NIP-44 decrypts plus a Schnorr verify, so a
 * large first decode in one unbroken loop freezes the UI for its duration.
 * Skips — foreign epochs, malformed, spliced — are silent.
 */
export async function openChatBatch(
  wraps: NostrRumor[],
  channel: Channel,
  opts?: { signal?: AbortSignal },
): Promise<OpenedChat[]> {
  const out: OpenedChat[] = [];
  let sliceStart = Date.now();
  for (let i = 0; i < wraps.length; i++) {
    if (opts?.signal?.aborted) break;
    const opened = openOne(wraps[i], channel);
    if (opened) out.push(opened);
    if (i + 1 < wraps.length && Date.now() - sliceStart >= DECODE_SLICE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }
  return out;
}

// ── Tag helpers ──────────────────────────────────────────────────────────────

/**
 * The thread-root rumor id a message belongs to, or undefined for a top-level
 * message.
 *
 * Threaded replies are NIP-22 kind-1111 comments carrying the root in their
 * uppercase `E` tag. A kind-9 `q` tag is an INLINE quote-reply per NIP-C7 — a
 * timeline row, not a thread — so it is deliberately NOT treated as a root.
 * Conflating the two is a rendering bug in every other client.
 */
export function replyTargetOf(ev: {
  kind: number;
  tags: string[][];
}): string | undefined {
  return ev.kind === KIND_COMMENT
    ? ev.tags.find((t) => t[0] === "E")?.[1]
    : undefined;
}

/** Reactions, edits and deletes name their target rumor with an `e` tag. */
export function eTargetOf(ev: { tags: string[][] }): string | undefined {
  return ev.tags.find((t) => t[0] === "e")?.[1];
}

/** One emoji key: a `:shortcode:` collapses to its bare name. */
function reactionContentKey(content: string): string {
  const shortcode = /^:([a-zA-Z0-9_-]+):$/.exec(content.trim());
  return shortcode ? shortcode[1] : content.trim();
}

// ── The fold ─────────────────────────────────────────────────────────────────

export interface ChatModeration {
  /**
   * Banned author pubkeys — every event from them is dropped (CORD-04 §4).
   *
   * This is the ONLY author-identity drop an honest client performs. Nothing
   * here filters on epoch: a retired epoch's key is held by everyone who ever
   * had it, but CORD-02 §5 makes an author seen publishing observably present
   * and a self-signed Join unsuppressable, and CORD-04 §6 makes the Banlist the
   * removal that enforces. An allow-list gate over retired-epoch history would
   * invert both, and would hide real history from exactly the clients whose
   * local anchors are thinnest.
   */
  banned: Set<string>;
  /**
   * Whether `deleter` may delete a message by `author` (MANAGE_MESSAGES).
   *
   * `citation` is the delete rumor's `vac` (CORD-04 §5) — the Grant the deleter
   * claims their rank under. A non-owner moderation delete without a resolvable
   * one PARKS: the permission check alone would honor an actor whose demotion
   * this client has not synced yet. A self-delete is not an authority action and
   * never carries one.
   */
  canDelete: (
    deleter: string,
    author: string,
    action?: { citation?: AuthorityCitation; ms: number },
  ) => boolean;
  /**
   * Whether `author` may be believed about a disappearing-messages timer change
   * (CORD-08 §4): holds MANAGE_METADATA in the fold. A kind-1740 notice is
   * informational — the metadata fold is the authority — but display is gated
   * like an authority claim, or anyone could spell the tag.
   */
  canSetTimer?: (author: string) => boolean;
}

/**
 * The moderation wiring a fold of one community's chat needs.
 *
 * Extracted so the two readers of a channel's history — the timeline and the
 * local search — cannot wire it differently. A search result the timeline
 * would refuse to render is the whole failure mode search has to avoid, and it
 * would arrive as a slightly different `canDelete` rather than as anything a
 * reviewer would spot.
 */
export function chatModerationOf(
  folded: Pick<
    FoldedControl,
    "banned" | "roster" | "ownerHex" | "heads" | "bannedAt" | "incomplete"
  >,
  communityId: Uint8Array,
): ChatModeration {
  return {
    banned: folded.banned,
    canDelete: (deleter, author, action) =>
      deleter !== author &&
      canActOnMember(
        folded.roster,
        deleter,
        folded.ownerHex,
        author,
        Permissions.MANAGE_MESSAGES,
      ) &&
      citationSatisfied(folded, communityId, deleter, action?.citation),
    canSetTimer: (author) =>
      isAuthorized(
        folded.roster,
        author,
        folded.ownerHex,
        Permissions.MANAGE_METADATA,
      ),
  };
}

/** A tallied reaction: reactors (pubkey → rumorId) plus any custom-emoji URL. */
export interface ReactionEntry {
  reactors: Map<string, string>;
  url?: string;
}

/** A message a MODERATOR removed, kept so the reader can be told it existed. */
export interface RemovedMessage {
  /** The message that was removed — its author, id and time, not its content. */
  target: OpenedChat;
  /** The moderator whose authorized kind-5 removed it. */
  deleter: string;
  /** Millisecond time of the removed message (not of the delete). */
  ms: number;
}

export interface FoldedTimeline {
  /** Surviving messages, sorted by `ms` ascending. */
  messages: OpenedChat[];
  /** target rumor id → emoji → tally. */
  reactions: Map<string, Map<string, ReactionEntry>>;
  /**
   * Authorized disappearing-messages timer notices (kind 1740, CORD-08 §4),
   * sorted by `ms` ascending. Not messages — a reader interleaves them as
   * centered notice rows.
   */
  timerNotices: OpenedChat[];
  /**
   * Moderator removals, sorted by target `ms` ascending — the facts a tombstone
   * row is drawn from.
   *
   * A SELF-delete is never in here, deliberately. A member scrubbing their own
   * past message is the one erasure CORD-02 §9 protects even after a community
   * is dissolved, and a row saying "something was here" would advertise exactly
   * what they removed. Their message stays a silent gap; only a removal someone
   * ELSE performed is announced, because that is an act of moderation the
   * community's members are entitled to see happened.
   */
  removed: RemovedMessage[];
}

/**
 * Reaction rumor ids deleted by a kind-5, remembered ACROSS folds.
 *
 * The store's NIP-09 pass only sees deletes in the same write batch, so a
 * reaction re-delivered by a relay echo in a later batch is re-added. This set
 * keeps such a reaction removed instead of resurrecting it.
 */
const deletedReactionIds = new Set<string>();
const DELETED_REACTION_CAP = 8192;

/**
 * Mark a reaction rumor id deleted NOW, before the kind-5 is sealed and stored,
 * so the removal shows immediately rather than after the send round-trips.
 */
export function markReactionDeleted(rumorId: string): void {
  if (deletedReactionIds.size >= DELETED_REACTION_CAP) {
    deletedReactionIds.delete(
      deletedReactionIds.values().next().value as string,
    );
  }
  deletedReactionIds.add(rumorId);
}

/**
 * Fold a batch of opened chat events into the channel timeline: drop banned
 * authors and expired rumors, apply edits (author-only, latest by `ms`), and
 * tally reactions per target.
 *
 * Deletes are applied HERE and nowhere else. Nothing ever removes a row from
 * the store — `writeChatRumors` only puts — so the kind-5 and the message it
 * names both stay on disk and this pass re-applies the removal on every read.
 * That is deliberate rather than incidental: a tombstone row needs both events
 * to still exist, and a physical delete would leave the reader with an
 * unexplained gap and no way to say who made it. (Armada does delete the row;
 * CORD.md §405 authorizes a moderator's delete without mandating removal, so the
 * two clients differ here and both are honest.)
 *
 * The removal is not silent for a moderator's delete: `removed` carries the
 * target and the deleter so the reader is told a message was taken down. A
 * self-delete leaves nothing behind — see {@link FoldedTimeline.removed}.
 */
export function foldTimeline(
  opened: OpenedChat[],
  moderation?: ChatModeration,
): FoldedTimeline {
  const byId = new Map<string, OpenedChat>();
  // target rumor id → (deleter → their citation + the delete's own ms). Both
  // have to survive: collapsing to a bare author set is what makes the authority
  // check permission-only, and the ms is what tells a delete that predates a
  // tombstone from one published after it.
  const deletes = new Map<
    string,
    Map<string, { citation?: AuthorityCitation; ms: number }>
  >();
  // ALL edits per target — author validity is judged in the apply phase, or a
  // non-author's later "edit" would suppress the author's legitimate one.
  const edits = new Map<
    string,
    Array<{ author: string; content: string; ms: number }>
  >();
  const reactions = new Map<string, Map<string, ReactionEntry>>();
  const timerNotices: OpenedChat[] = [];
  // ONE clock per fold: a rumor expiring mid-loop must not split the batch.
  const nowSecs = Math.floor(Date.now() / 1000);

  for (const ev of opened) {
    if (moderation?.banned.has(ev.author)) continue;
    // Expired rumors are refused at ingest (CORD-08 §3), but rows stored before
    // their deadline passed — and freshly-decrypted events folded in ahead of
    // the store round-trip — reach here, so the read side applies the rule too.
    if (isExpired(ev.tags, nowSecs)) continue;

    if (ev.kind === KIND_TIMER_NOTICE) {
      // A notice with no readable timer value is malformed, not "off"; an author
      // the roster doesn't trust with MANAGE_METADATA is dropped (CORD-08 §4).
      // Anyone can spell the tag; only staff are believed.
      if (timerNoticeSeconds(ev) === undefined) continue;
      if (moderation?.canSetTimer && !moderation.canSetTimer(ev.author)) {
        continue;
      }
      timerNotices.push(ev);
      continue;
    }

    if (ev.kind === KIND_DELETE) {
      // NIP-09 shape: possibly several `e` targets.
      for (const t of ev.tags) {
        if (t[0] !== "e" || !t[1]) continue;
        const target = t[1];
        let authors = deletes.get(target);
        if (!authors) deletes.set(target, (authors = new Map()));
        // Prefer a CITED delete when the same actor published both — an uncited
        // duplicate must never mask the one that carries authority.
        const cite = citationFromTags(ev.tags);
        if (cite || !authors.has(ev.author)) {
          authors.set(ev.author, { citation: cite, ms: ev.ms });
        }
        // Remember deleted reaction ids across folds, so a relay-echoed reaction
        // re-added to the store in a later batch stays removed.
        const kTag = ev.tags.find(([n]) => n === "k")?.[1];
        if (kTag === String(KIND_REACTION)) markReactionDeleted(target);
      }
      continue;
    }

    if (ev.kind === KIND_EDIT) {
      const target = eTargetOf(ev);
      if (!target) continue;
      let list = edits.get(target);
      if (!list) edits.set(target, (list = []));
      list.push({ author: ev.author, content: ev.content, ms: ev.ms });
      continue;
    }

    if (ev.kind === KIND_REACTION) {
      const target = eTargetOf(ev);
      if (!target || !ev.content) continue;
      if (deletedReactionIds.has(ev.rumorId)) continue;
      const key = reactionContentKey(ev.content);
      const url = ev.tags.find((t) => t[0] === "emoji")?.[2];
      let byEmoji = reactions.get(target);
      if (!byEmoji) reactions.set(target, (byEmoji = new Map()));
      let entry = byEmoji.get(key);
      if (!entry) byEmoji.set(key, (entry = { reactors: new Map() }));
      entry.reactors.set(ev.author, ev.rumorId);
      if (url && !entry.url) entry.url = url;
      continue;
    }

    // kind-9 messages, kind-1111 threaded replies, and the standalone-content
    // kinds grimoire does not fold specially (polls, calendar events) all land
    // in the timeline pool, where the kind registry renders them. Side events
    // that reference another rumor — votes, RSVPs, zap receipts — are skipped
    // above by omission: a vote is not a timeline row.
    if (
      ev.kind === KIND_MESSAGE ||
      ev.kind === KIND_COMMENT ||
      ev.kind === KIND_POLL ||
      ev.kind === KIND_CALENDAR_DATE ||
      ev.kind === KIND_CALENDAR_TIME
    ) {
      byId.set(ev.rumorId, ev);
    }
  }

  // Edits: only the original author may edit; their latest (by ms) wins.
  for (const [id, list] of edits) {
    const msg = byId.get(id);
    if (!msg) continue;
    let best: { content: string; ms: number } | undefined;
    for (const e of list) {
      if (e.author !== msg.author) continue;
      if (!best || e.ms > best.ms) best = e;
    }
    if (best) {
      const tags = msg.tags.filter(([name]) => name !== "edited");
      tags.push(["edited", String(Math.floor(best.ms / 1000))]);
      byId.set(id, { ...msg, content: best.content, tags });
    }
  }

  // Deletes: a self-delete, or an authorized moderator delete.
  const removed: RemovedMessage[] = [];
  for (const [id, msg] of byId) {
    const deleters = deletes.get(id);
    if (!deleters) continue;
    // Self FIRST, and the order is the rule: a message its own author deleted
    // leaves no trace even when a moderator deleted it too. Recording the
    // moderator there would announce an erasure the author performed themselves.
    if (deleters.has(msg.author)) {
      byId.delete(id);
      continue;
    }
    if (moderation === undefined) continue;
    // The EARLIEST authorized delete is the one credited, so two moderators
    // acting on the same message name the one who actually took it down rather
    // than whichever the Map happened to iterate first.
    let actor: { deleter: string; ms: number } | undefined;
    for (const [deleter, act] of deleters) {
      if (!moderation.canDelete(deleter, msg.author, act)) continue;
      if (!actor || act.ms < actor.ms) actor = { deleter, ms: act.ms };
    }
    if (!actor) continue;
    byId.delete(id);
    removed.push({ target: msg, deleter: actor.deleter, ms: msg.ms });
  }

  // In-batch reaction deletes: a kind-5 targeting a reaction rumor removes that
  // reactor from the tally.
  for (const [targetId, byEmoji] of reactions) {
    for (const [emoji, entry] of byEmoji) {
      for (const [pubkey, rumorId] of entry.reactors) {
        if (deletes.get(rumorId)?.has(pubkey)) entry.reactors.delete(pubkey);
      }
      if (entry.reactors.size === 0) byEmoji.delete(emoji);
    }
    if (byEmoji.size === 0) reactions.delete(targetId);
  }

  return {
    messages: [...byId.values()].sort((a, b) => a.ms - b.ms),
    reactions,
    timerNotices: timerNotices.sort((a, b) => a.ms - b.ms),
    removed: removed.sort((a, b) => a.ms - b.ms),
  };
}
