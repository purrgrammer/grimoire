/**
 * The message outbox: what you asked to send, until a relay takes it.
 *
 * Publish-first is preserved rather than overturned. `concordRumors` still
 * never holds a message no relay accepted — that would be a lie the reader
 * cannot see through, which is the invariant the adapter's docstring exists
 * for. This is a SEPARATE surface: a pending or failed send lives here, is
 * merged into the timeline with a delivery badge on it, and moves into the
 * rumor store only once it has actually been accepted.
 *
 * **The row is the INTENT, not a sealed wrap.** A wrap is sealed under the
 * channel's CURRENT epoch and its rumor id commits to the timestamp and NIP-40
 * deadline stamped when it was built. Queue a signed wrap and a CORD-06
 * rotation makes it undecodable to the very members it was for, while a
 * disappearing timer makes `writeChatRumors` refuse it on arrival. So every
 * attempt rebuilds through `buildChatSend` and mints a new rumor id, which is
 * armada's retry-as-a-fresh-send shape too.
 *
 * One deliberate divergence from armada: it preserves a reply's thread tags
 * verbatim so a retry survives the parent's deletion. This stores only the
 * parent's rumor id and re-resolves it at every attempt, failing the row with a
 * plain sentence when the parent is gone. The tags are then exactly the ones
 * `buildChatSend` mints, and "the message you were replying to is gone" is the
 * honest outcome rather than a reply pointing at nothing.
 *
 * Draining is coupled to the wire on purpose. Publishing goes out over
 * `relay.multiplex()` (see `concord-publish.ts`), and on a gating relay only
 * the wire's standing REQ has settled the stream AUTH that makes a wrap
 * acceptable — so the trigger is `c2up:<relay>`, a relay's round answering, and
 * not `navigator.onLine`.
 */

import { messageExpirationOf } from "@/lib/concord/disappearing";
import { KIND_COMMENT, KIND_MESSAGE } from "@/lib/concord/kinds";
import { buildChatSend, type ReplyParent } from "@/lib/concord/send";
import { consumeSend } from "@/lib/concord/send-rate-limit";
import {
  channelScope,
  emitWireScopes,
  onWireScopes,
  WIRE_UP_PREFIX,
} from "@/lib/concord/wire-bus";
import accountManager from "@/services/accounts";
import { resolveChannel } from "@/services/concord-channel-resolve";
import { dissolvedAt } from "@/services/concord-dissolution";
import { publishWrap } from "@/services/concord-publish";
import {
  readChannelRumor,
  writeChatRumors,
} from "@/services/concord-rumor-store";
import { wireRelays } from "@/services/concord-wire";
import db, { OUTBOX_NEVER, type ConcordOutboxRow } from "@/services/db";

/** Backoff floor and ceiling between attempts, in seconds. */
const BACKOFF_MIN_SECS = 30;
const BACKOFF_MAX_SECS = 15 * 60;

/** What a caller hands over to queue a message. */
export type OutboxIntent = Omit<
  ConcordOutboxRow,
  "id" | "status" | "attempts" | "nextAttemptAt" | "lastError"
>;

/** Queue one message. Returns the row, whose `id` the sender keeps. */
export async function enqueueOutbox(
  intent: OutboxIntent,
): Promise<ConcordOutboxRow> {
  const row: ConcordOutboxRow = {
    ...intent,
    id: crypto.randomUUID(),
    status: "sending",
    attempts: 1,
  };
  await db.concordOutbox.put(row);
  return row;
}

/** Everything still in flight in one channel, for this account. Oldest first. */
export async function outboxForChannel(
  communityId: string,
  channel: string,
  pubkey: string,
): Promise<ConcordOutboxRow[]> {
  if (!communityId || !channel || !pubkey) return [];
  try {
    const rows = await db.concordOutbox
      .where("[communityId+channel]")
      .equals([communityId, channel.toLowerCase()])
      .toArray();
    return rows
      .filter((row) => row.pubkey === pubkey)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch (error) {
    console.warn("[concord] could not read the outbox:", error);
    return [];
  }
}

/** Mark an attempt as under way, and record the rumor id it will carry. */
export async function markOutboxSending(
  id: string,
  rumorId: string,
): Promise<void> {
  await db.concordOutbox
    .update(id, { status: "sending", lastAttemptRumorId: rumorId })
    .catch(() => 0);
}

/**
 * Record a failure, and when it may be tried again.
 *
 * `retryAt` absent means the exponential backoff; {@link OUTBOX_NEVER} means a
 * refusal no retry can change (banned, dissolved, a parent that is gone), which
 * only the reader's own Retry can move.
 */
export async function markOutboxFailed(
  id: string,
  error: string,
  retryAt?: number,
  /** The pass's clock, so a backoff is measured from the attempt, not from now. */
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  try {
    const row = await db.concordOutbox.get(id);
    if (!row) return;
    const attempts = row.attempts + 1;
    await db.concordOutbox.update(id, {
      status: "failed",
      attempts,
      lastError: error,
      nextAttemptAt: retryAt ?? backoffAt(attempts, nowSecs),
    });
  } catch (storeError) {
    console.warn("[concord] could not mark the send as failed:", storeError);
  }
}

/** Drop a row: it was accepted, or the reader discarded it. */
export async function removeOutbox(id: string): Promise<void> {
  await db.concordOutbox.delete(id).catch(() => undefined);
}

/** Put a failed row back in line, now. */
export async function retryOutbox(id: string): Promise<void> {
  await db.concordOutbox
    .update(id, { status: "sending", nextAttemptAt: 0, lastError: undefined })
    .catch(() => 0);
}

/** Rows this account may attempt now, oldest first. */
export async function dueOutbox(
  pubkey: string,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<ConcordOutboxRow[]> {
  if (!pubkey) return [];
  try {
    const rows = await db.concordOutbox
      .where("pubkey")
      .equals(pubkey)
      .toArray();
    return rows
      .filter((row) => (row.nextAttemptAt ?? 0) <= nowSecs)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch (error) {
    console.warn("[concord] could not read the outbox queue:", error);
    return [];
  }
}

function backoffAt(
  attempts: number,
  nowSecs: number = Math.floor(Date.now() / 1000),
): number {
  const wait = Math.min(
    BACKOFF_MIN_SECS * 2 ** Math.max(0, attempts - 1),
    BACKOFF_MAX_SECS,
  );
  return nowSecs + wait;
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Rows an attempt is running for right now, so a second pass cannot double it. */
const inFlight = new Set<string>();
let draining = false;

/**
 * Claim a row for an attempt happening OUTSIDE the drain, and release it after.
 *
 * The adapter publishes the first attempt itself, in the background, for up to
 * the publish timeout. Without this claim a drain fired in that window — a
 * relay round re-establishing, or a Retry on some other row — would find the
 * queued row due, miss the dedupe pre-check because the wrap has not been
 * accepted yet, rebuild it under a NEW rumor id and publish a second copy. Both
 * would be accepted, and nothing afterwards could tell they were one message.
 */
export function holdOutboxRow(id: string): () => void {
  inFlight.add(id);
  return () => inFlight.delete(id);
}

/**
 * Try every due row once, oldest first.
 *
 * Sequential rather than parallel: each attempt spends the community's send
 * budget, and a burst of parallel rebuilds would trip the rate limit against
 * itself. A rate-limit refusal stops the whole pass — the next row would be
 * refused for the same reason a moment later.
 */
export async function drainOutbox(
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const account = accountManager.active$.value;
  if (!account?.pubkey) return;
  if (draining) return;
  draining = true;
  try {
    for (const row of await dueOutbox(account.pubkey, nowSecs)) {
      if (inFlight.has(row.id)) continue;
      inFlight.add(row.id);
      try {
        const verdict = await attemptRow(row, account, nowSecs);
        if (verdict === "stop") break;
      } finally {
        inFlight.delete(row.id);
      }
    }
  } finally {
    draining = false;
  }
}

type Verdict = "next" | "stop";

async function attemptRow(
  row: ConcordOutboxRow,
  account: { pubkey: string; signer: Parameters<typeof buildChatSend>[1] },
  nowSecs: number,
): Promise<Verdict> {
  // At-least-once, deduped: a previous attempt may have been ACCEPTED and the
  // app died before the row could be dropped. The accepted wrap comes back
  // round through the wire, so if its rumor is in the store the send happened
  // — rebuilding here would post a visible duplicate that nothing can catch.
  if (row.lastAttemptRumorId) {
    const landed = await readChannelRumor(
      row.communityId,
      row.channel,
      row.lastAttemptRumorId,
    );
    if (landed) {
      await removeOutbox(row.id);
      emitWireScopes([channelScope(row.channel)]);
      return "next";
    }
  }

  // Every failure below rings the channel: the row is on screen as "Sending",
  // and a badge that only corrects itself when some unrelated message happens
  // to arrive is a message the reader believes is still going out.
  const ring = () => emitWireScopes([channelScope(row.channel)]);

  let resolved;
  try {
    resolved = await resolveChannel(row.communityId, row.channel);
  } catch (error) {
    // A locked vault or a fold still catching up — try again later.
    await markOutboxFailed(row.id, reason(error), undefined, nowSecs);
    ring();
    return "next";
  }
  const { community, channel, folded } = resolved;

  if (folded.banned.has(account.pubkey)) {
    await markOutboxFailed(
      row.id,
      "You have been banned from this community.",
      OUTBOX_NEVER,
    );
    ring();
    return "next";
  }
  // CORD-02 §9: the seal is one-way, and a queued message is new content.
  const dead = await dissolvedAt(community.idHex).catch(() => undefined);
  if (dead !== undefined) {
    await markOutboxFailed(
      row.id,
      "This community has been dissolved; it accepts nothing new.",
      OUTBOX_NEVER,
    );
    ring();
    return "next";
  }

  // Resolved BEFORE the rate limit is spent: a row that is about to fail for
  // good would otherwise burn the community's send budget on its way out, and
  // stop the pass — leaving a live message behind a dead one.
  let replyTo: ReplyParent | undefined;
  if (row.replyToId) {
    const parent = await readChannelRumor(
      row.communityId,
      row.channel,
      row.replyToId,
    );
    if (!parent) {
      await markOutboxFailed(
        row.id,
        "The message this was replying to is gone.",
        OUTBOX_NEVER,
      );
      ring();
      return "next";
    }
    replyTo = {
      id: parent.rumorId,
      kind: parent.kind,
      pubkey: parent.author,
      tags: parent.tags,
    };
  }

  // A drained message is a fresh post, so it spends fresh budget — matching
  // armada's retry-as-a-new-send. Spent BEFORE anything is signed.
  const waitMs = consumeSend(community.idHex);
  if (waitMs > 0) {
    await markOutboxFailed(
      row.id,
      "Sending too fast — waiting before trying again.",
      nowSecs + Math.ceil(waitMs / 1000),
    );
    ring();
    return "stop";
  }

  let built;
  try {
    built = await buildChatSend(
      {
        content: row.content,
        channel,
        pubkey: account.pubkey,
        ...(replyTo ? { replyTo } : { kind: row.kind }),
        ...(row.extraTags ? { extraTags: row.extraTags } : {}),
        // The timer as folded AT ATTEMPT TIME, not at compose time: the tag as
        // signed governs, and this rumor is being signed now.
        timerSecs: messageExpirationOf(folded.metadata),
      },
      account.signer,
    );
  } catch (error) {
    await markOutboxFailed(row.id, reason(error), undefined, nowSecs);
    ring();
    return "next";
  }

  // Recorded BEFORE the publish, never after: this id is the only thing that
  // can tell a later drain that a wrap already landed, and a crash between the
  // publish and the write is exactly the case it exists for.
  await markOutboxSending(row.id, built.rumor.id);

  try {
    await publishWrap(community.relays, built.wrap);
  } catch (error) {
    await markOutboxFailed(row.id, reason(error), undefined, nowSecs);
    ring();
    return "next";
  }

  const written = await writeChatRumors(community.idHex, [
    {
      rumorId: built.rumor.id,
      author: account.pubkey,
      kind: built.rumor.kind,
      content: built.rumor.content,
      tags: built.rumor.tags,
      createdAt: built.createdAt,
      ms: built.ms,
      wrapId: built.wrap.id,
      channel: channel.idHex,
    },
  ]);
  // Accepted, so the row goes — even if the store write failed. A relay took
  // the wrap and the wire echo will bring it back; marking this failed instead
  // would rebuild and republish a message the reader can already see elsewhere.
  await removeOutbox(row.id);
  if (!written.ok) {
    console.warn(
      "[concord] sent, but this device could not save it — it will reappear when it is fetched again",
    );
  }
  ring();
  return "next";
}

// ── The triggers ────────────────────────────────────────────────────────────

let stopBus: (() => void) | undefined;
let onlineBound = false;

const onOnline = () => {
  // `navigator.onLine` says a network exists, not that this community's relay
  // is reachable and stream-authenticated. The wire holding rounds open is the
  // closest thing to that, and a drain with no live round would just burn
  // attempts into the backoff.
  if (wireRelays().length === 0) return;
  void drainOutbox();
};

/** Start listening for the moments a queued send can go. Idempotent. */
export function startOutboxDrain(): void {
  if (stopBus) return;
  stopBus = onWireScopes((scopes) => {
    for (const scope of scopes) {
      if (scope.startsWith(WIRE_UP_PREFIX)) {
        void drainOutbox();
        return;
      }
    }
  });
  if (typeof window !== "undefined" && !onlineBound) {
    onlineBound = true;
    window.addEventListener("online", onOnline);
  }
}

/** Stop listening. Idempotent. */
export function stopOutboxDrain(): void {
  stopBus?.();
  stopBus = undefined;
  if (onlineBound && typeof window !== "undefined") {
    onlineBound = false;
    window.removeEventListener("online", onOnline);
  }
}

/** Kinds that may ever be queued — see the module docstring. */
export const OUTBOX_KINDS: ReadonlySet<number> = new Set([
  KIND_MESSAGE,
  KIND_COMMENT,
]);
