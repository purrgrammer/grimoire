/**
 * Concord chat adapter — one channel of one community (CORD-03).
 *
 * Unlike every other adapter here, this one does NOT subscribe to relays for
 * messages. Concord traffic is opaque kind-1059 wraps, so a wrap is decrypted
 * once at ingest and the recovered rumor is stored; the timeline then reads back
 * out of Dexie as an ordinary indexed query with no crypto. `loadMessages`
 * therefore emits from the STORE, and live delivery arrives as a doorbell from
 * the wire (`c2:<channel>`) rather than as events on a socket this adapter owns.
 * The backfill it kicks alongside is for HISTORY — paging backwards — not for
 * new messages.
 *
 * Sending is PUBLISH-FIRST: build, seal, wrap, publish, and only then write to
 * the store. The invariant that buys is that **`concordRumors` never holds a
 * message no relay accepted** — a row in the store means it was delivered, and
 * nothing in the timeline's history can be a message that only ever existed
 * here.
 *
 * A message still in flight is not written into the store, then. It lives in
 * the OUTBOX (`concord-outbox.ts`), a separate table, and is merged into the
 * emitted timeline carrying a `delivery` state the reader can see and act on.
 * So `sendMessage` resolves once the message is QUEUED rather than once it is
 * delivered: the composer clears immediately, a failure shows up as a badge
 * with Retry and Discard beside it instead of as a toast that took the text
 * with it, and a send attempted with no connection survives until there is one.
 * Every pre-queue refusal — signed out, banned, dissolved, rate-limited, an
 * unresolvable reply parent, a signer that will not answer — still throws, and
 * that is exactly when putting the text back in the composer is right.
 *
 * **Reactions and self-deletes are unchanged**, deliberately: they publish
 * first and throw on failure, with nothing queued. A queued reaction would need
 * a UI surface of its own and an answer to "react to a message that was deleted
 * while you were offline" that no CORD document gives, and a self-delete that
 * resolved optimistically would let the context menu say "Message deleted"
 * about a message that is still there. So only messages queue — which is also
 * what lets the timeline merge treat every outbox row as a message row.
 */

import { Observable, ReplaySubject } from "rxjs";
import type { AddressPointer, EventPointer } from "nostr-tools/nip19";

import {
  chatModerationOf,
  foldTimeline,
  type OpenedChat,
  type ReactionEntry,
} from "@/lib/concord/chat";
import { filterEpochCutoff } from "@/lib/concord/chat";
import { KIND_COMMENT } from "@/lib/concord/kinds";
import type { BlobAttachmentMeta } from "./base-adapter";
import type { FoldedControl } from "@/lib/concord/control";
import type { Channel, Community } from "@/lib/concord/types";
import { channelScope, onWireScope } from "@/lib/concord/wire-bus";
import {
  readStoredRoster,
  rosterParticipants,
  syncRoster,
} from "@/services/concord-members";
import {
  buildChatSend,
  type BuildChatSendOptions,
  type ReplyParent,
} from "@/lib/concord/send";
import {
  consumeSend,
  isRateLimitedKind,
  SendRateLimitError,
} from "@/lib/concord/send-rate-limit";
import { KIND_DELETE, KIND_MESSAGE, KIND_REACTION } from "@/lib/concord/kinds";
import { messageExpirationOf } from "@/lib/concord/disappearing";
import { extractMentionTags } from "@/lib/chat/mentions";
import { emitWireScopes } from "@/lib/concord/wire-bus";
import { syncChannel } from "@/services/concord-channel-sync";
import {
  resolveChannel,
  type ResolvedChannel,
} from "@/services/concord-channel-resolve";
import { publishWrap } from "@/services/concord-publish";
import { dissolvedAt } from "@/services/concord-dissolution";
import {
  drainOutbox,
  enqueueOutbox,
  holdOutboxRow,
  markOutboxFailed,
  outboxForChannel,
  removeOutbox,
  retryOutbox,
} from "@/services/concord-outbox";
import type { ChannelUnread } from "@/services/concord-rumor-store";
import {
  channelAuthors,
  channelUnreadSummary,
  queryChannelRumors,
  readChannelRumor,
  writeChatRumors,
} from "@/services/concord-rumor-store";
import {
  CONCORD_READ_MAX_FUTURE_SECS,
  markChannelRead,
  readLastRead,
} from "@/services/concord-reads";
import accountManager from "@/services/accounts";
import type {
  ChatCapabilities,
  ConcordIdentifier,
  Conversation,
  LoadMessagesOptions,
  Message,
  Participant,
  ProtocolIdentifier,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import type { EmojiTag } from "@/lib/emoji-helpers";

import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";

/** How many timeline rows one page holds. */
const PAGE_ROWS = 200;

/** `communityId:channelId` — the Conversation id, and the emitter key. */
const conversationIdOf = (id: ConcordIdentifier) =>
  `${id.communityId}:${id.channelId}`;

function parseConversationId(conversationId: string): ConcordIdentifier | null {
  const [communityId, channelId] = conversationId.split(":");
  if (!/^[0-9a-f]{64}$/.test(communityId ?? "")) return null;
  if (!/^[0-9a-f]{64}$/.test(channelId ?? "")) return null;
  return { type: "concord", communityId, channelId };
}

export class ConcordAdapter extends ChatProtocolAdapter {
  readonly protocol = "concord" as const;
  readonly type = "group" as const;

  /**
   * Per-conversation emitters, so a backfill can push into a live timeline.
   *
   * A ReplaySubject(1) rather than a BehaviorSubject seeded with `[]`:
   * ChatViewer reads an undefined stream as "still loading" and an empty array
   * as "no messages yet", so seeding it would flash
   * "No messages yet. Start the conversation!" over a channel that is merely
   * still being read. Replaying the last value is what makes re-entering a
   * channel paint instantly.
   */
  private timelines = new Map<string, ReplaySubject<Message[]>>();

  /** Conversations whose read+backfill has already been kicked off. */
  private started = new Set<string>();

  /** Last emitted timeline signature per conversation (see {@link publish}). */
  private lastEmitted = new Map<string, string>();

  /** Wire-bus unsubscribes, one per live conversation. */
  private doorbells = new Map<string, () => void>();

  /**
   * How many rows the reader has asked this conversation to show, per paging.
   *
   * It lives on the adapter rather than in a `read()` argument because the two
   * reads that repaint the timeline cannot carry it: the doorbell closure is
   * pinned to the `options` its `loadMessages` call was made with (ChatViewer
   * passes none), and the backfill's `onFresh` re-read is pinned the same way.
   * Without this, every "load older" click fetched history into the store and
   * then immediately re-read the newest {@link PAGE_ROWS} rows over it, so the
   * page was never rendered and the button did nothing at all.
   */
  private windows = new Map<string, number>();

  /**
   * Background publishes this adapter has started and not yet finished.
   *
   * `sendMessage` resolves at enqueue, so its relay work outlives the call. The
   * set exists so a test can wait for that work rather than racing it — nothing
   * in the app reads it.
   */
  private sending = new Set<Promise<void>>();

  /** Test seam: settle every background publish already started. */
  async _settleSends(): Promise<void> {
    await Promise.allSettled([...this.sending]);
  }

  /**
   * A Concord channel is never addressed by a typed string.
   *
   * Both ids are raw hex and both are meaningless without held key material, so
   * there is nothing a user could usefully type — the community viewer builds
   * the identifier from the folded channel list instead. Accepting
   * `<community>:<channel>` here is for round-tripping a Conversation id, not a
   * user-facing syntax.
   */
  parseIdentifier(input: string): ConcordIdentifier | null {
    return parseConversationId(input.trim().toLowerCase());
  }

  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (identifier.type !== "concord") {
      throw new Error(
        `Concord adapter cannot handle identifier type: ${identifier.type}`,
      );
    }
    const { community, channel, folded } = await this.resolve(identifier);

    // The roster is read LOCALLY and refreshed behind the open. The Guestbook is
    // off-consensus (CORD-02 §5) and the observed-authors half already comes
    // from stored chat rumors, so the store answers immediately and usefully;
    // blocking a channel open on a REQ to a relay that may never answer would
    // trade a live channel for a member count.
    const roster = await readStoredRoster(community, folded);
    void syncRoster(community, folded).catch(() => undefined);

    const participants: Participant[] = rosterParticipants(roster, folded, {
      idHex: channel.idHex,
      isPrivate: channel.isPrivate,
      // Only a private channel narrows, so only it pays for this read.
      ...(channel.isPrivate
        ? { authors: await channelAuthors(community.idHex, channel.idHex) }
        : {}),
    });

    return {
      id: conversationIdOf(identifier),
      type: "group",
      protocol: "concord",
      title: channel.name,
      participants,
      metadata: {
        // The community's name leads the description: the window title carries
        // the channel, and the reader needs to know which community it is in.
        description: [
          folded.metadata?.name ?? community.name,
          folded.metadata?.description,
        ]
          .filter(Boolean)
          .join(" — "),
        encrypted: true,
        // The community's relay set, so the chat header can show where this
        // channel is actually being read from — the same affordance NIP-29
        // gets from its single relay. The FOLD is the authority (CORD-02 §6);
        // `community.relays` is the join-time preview and only stands in until
        // a metadata edition has been read.
        relays:
          folded.metadata?.relays && folded.metadata.relays.length > 0
            ? folded.metadata.relays
            : community.relays,
        // Not a typeable address — a channel lives at a derived pubkey and has
        // no `relay'id` form to paste back — but the id is what identifies a
        // channel in the store, in a filter and in a bug report, so it is worth
        // being able to copy.
        channelId: channel.idHex,
      },
      // A SNAPSHOT, taken as the channel opens — `Conversation` is resolved
      // once and does not re-resolve when a message lands. Live badges come
      // from `useConcordUnread`, which re-runs the same summary off Dexie.
      // Both paths share `channelUnreadSummary`, so they can be stale relative
      // to one another but never disagree about what "unread" means.
      unreadCount: (await this.unread(identifier, folded.banned)).count,
    };
  }

  /**
   * Emit this channel's timeline from the store, and backfill alongside.
   *
   * The store is the read surface, so the first emission is whatever a previous
   * session already decrypted — a cold channel paints immediately and fills in.
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const identifier = parseConversationId(conversation.id);
    if (!identifier) return new Observable<Message[]>((s) => s.complete());

    let subject = this.timelines.get(conversation.id);
    if (!subject) {
      subject = new ReplaySubject<Message[]>(1);
      this.timelines.set(conversation.id, subject);
    }
    const emitter = subject;

    // ONCE per conversation. `loadMessages` is called again whenever the
    // caller's `conversation` object identity changes, and the emitter is shared
    // per channel — so without this each call started another read+backfill pair
    // pushing into the same stream. The visible symptom is a timeline that
    // flashes: every emission is a fresh array, which re-anchors the virtualizer.
    if (this.started.has(conversation.id)) return emitter.asObservable();
    this.started.add(conversation.id);

    // Seed the window from what this caller asked for. The repaints that follow
    // a "load older" click read with no options at all, so a caller asking for
    // more than {@link PAGE_ROWS} would watch its timeline SHRINK on the first
    // click. Inside the started-gate, so a repeat call cannot clobber a window
    // the reader has already paged wider.
    this.windows.set(conversation.id, options?.limit ?? PAGE_ROWS);

    // Live delivery. The wire has already decrypted and stored whatever caused
    // the ring, so the response is a local re-read — no relay in the path, and
    // `publish` stays silent if the timeline did not actually change.
    this.doorbells.get(conversation.id)?.();
    this.doorbells.set(
      conversation.id,
      onWireScope(channelScope(identifier.channelId), () => {
        void this.readMerged(identifier, options)
          .then((next) => this.publish(conversation.id, emitter, next))
          .catch(() => undefined);
      }),
    );

    void (async () => {
      try {
        // Paint from the store first, then backfill and repaint. A user
        // reopening a channel should not stare at an empty pane while a relay
        // round-trips.
        // Paint the store's answer — but ONLY if there is one. An empty first
        // read is indistinguishable from an empty channel to the reader, so
        // emitting it puts "No messages yet" over a channel whose history is
        // still on the wire. Staying silent leaves the stream undefined, which
        // is what ChatViewer reads as "still loading".
        const stored = await this.readMerged(identifier, options);
        if (stored.length > 0) this.publish(conversation.id, emitter, stored);
        // Repaint as each relay lands, not once at the end: the first relay to
        // answer is what the reader is waiting for, and `publish` stays silent
        // when a page added nothing new.
        await this.backfill(identifier, undefined, () => {
          void this.readMerged(identifier, options).then((next) =>
            this.publish(conversation.id, emitter, next),
          );
        });
        // After the backfill an empty answer IS the answer: the channel is
        // empty, and saying so is now honest.
        this.publish(
          conversation.id,
          emitter,
          await this.readMerged(identifier, options),
        );
      } catch (error) {
        console.warn("[concord] could not load the timeline:", error);
      }
    })();

    return emitter.asObservable();
  }

  /**
   * Emit only when the timeline actually changed.
   *
   * A repaint with identical content still hands the virtualizer a fresh array,
   * which re-anchors the scroll — so a re-read that found nothing new has to be
   * silent rather than merely harmless.
   */
  private publish(
    conversationId: string,
    emitter: ReplaySubject<Message[]>,
    next: Message[],
  ): void {
    // The delivery state is part of the signature, not just the id: a queued
    // message flipping from "sending" to "failed" changes no id at all, and an
    // id-only signature would suppress the very repaint that shows the reader
    // their message did not go.
    //
    // So is the tombstone flag, for the same reason and a worse consequence: a
    // moderator's delete turns a message into a removal row at the SAME id and
    // the same timestamp, so an id-and-delivery signature is unchanged and the
    // reader keeps seeing the content that was just taken down.
    const signature = next
      .map(
        (m) => `${m.id}:${m.delivery ?? ""}:${m.metadata?.deleted ? "x" : ""}`,
      )
      .join(",");
    if (this.lastEmitted.get(conversationId) === signature) return;
    this.lastEmitted.set(conversationId, signature);
    emitter.next(next);
  }

  /**
   * Page backwards: widen what the timeline shows, and fill it in.
   *
   * The caller's `before` is the oldest row it currently renders. Widening the
   * window is what actually makes the page appear — the returned array is not a
   * render path (ChatViewer counts it and throws it away), so a `loadMoreMessages`
   * that only fetched left the reader looking at the same messages.
   *
   * The page returned for that count is STRICTLY older than `before`. The store's
   * bound is inclusive, so `<=` would hand back the boundary row the caller
   * already has and make "is this the end of the history" off by one. The cost of
   * strict is that same-second siblings of the oldest rendered row do not count —
   * they still RENDER, because the emitter publishes the whole widened window;
   * only the count is short, and only 50+ messages sharing one second could end
   * paging a click early.
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const identifier = parseConversationId(conversation.id);
    if (!identifier) return [];
    const conversationId = conversationIdOf(identifier);
    // Widen BEFORE the fetch: the repaint each relay's page triggers reads
    // through this window, and a window grown afterwards would show the reader
    // nothing until the last relay had answered.
    const previous = this.windows.get(conversationId) ?? PAGE_ROWS;
    this.windows.set(conversationId, previous + PAGE_ROWS);

    const emitter = this.timelines.get(conversationId);
    const repaint = async (): Promise<Message[]> => {
      const next = await this.readMerged(identifier);
      if (emitter) this.publish(conversationId, emitter, next);
      return next;
    };

    // Backfill the relays BELOW the oldest row we hold — the page the caller
    // wants may only exist on the wire — repainting as each relay lands.
    try {
      await this.backfill(identifier, before, () => {
        void repaint().catch(() => undefined);
      });
    } catch (error) {
      // A failed click showed the reader nothing, so it must not leave the
      // window wide: every later doorbell ring would then re-read and re-fold a
      // page more than the timeline is showing, forever. The realistic thrower
      // is `resolve()` — a locked vault — which throws before any repaint, so
      // there is nothing on screen to contradict.
      this.windows.set(conversationId, previous);
      throw error;
    }
    const widened = await repaint();
    // Queued rows are excluded explicitly, not merely by being newer than the
    // boundary: this page is counted against the page size to decide whether
    // any history is left, and a message that has not been SENT yet is no
    // evidence about what a relay still holds.
    return widened.filter((m) => !m.delivery && m.timestamp < before);
  }

  /**
   * How far into this channel the viewer has read, in seconds. 0 if never.
   *
   * Local to this device and this account: nothing about read state goes on the
   * wire, because no CORD document defines a read marker to put there.
   */
  async getLastRead(conversation: Conversation): Promise<number> {
    const identifier = parseConversationId(conversation.id);
    const pubkey = accountManager.active$.value?.pubkey;
    if (!identifier || !pubkey) return 0;
    return readLastRead(pubkey, identifier.communityId, identifier.channelId);
  }

  /**
   * Stamp this channel read — and stamp it high enough to actually clear.
   *
   * **The invariant this method exists for: the stamp must be able to cover
   * everything the count counts.** The caller hands over the newest message the
   * TIMELINE is showing, but the timeline is the fold's output, and the fold
   * drops a banned author's messages, rumors past their NIP-40 deadline, and
   * rows sealed under a retired epoch. Dexie still holds every one of them, so
   * any of them can be NEWER than the newest thing on screen — and stamping the
   * newest thing on screen would leave the badge lit with nothing the reader
   * could ever click to clear it. So the stamp is raised to the summary's
   * `latest`, which is by construction the newest row the count counted.
   *
   * The clamp on the other side is for the same reason in the opposite
   * direction: `created_at` is whatever the author wrote, and chat ingest has no
   * clock check, so a year-3000 message must not mark the channel read forever.
   * Both bounds use the SAME allowance the scan does — clamping one and not the
   * other re-creates whichever bug was not clamped.
   *
   * A message arriving between the summary and the write is marked read. That is
   * acceptable and matches armada: the channel is open and on screen.
   */
  async markRead(
    conversation: Conversation,
    timestampSecs: number,
  ): Promise<void> {
    const identifier = parseConversationId(conversation.id);
    const pubkey = accountManager.active$.value?.pubkey;
    if (!identifier || !pubkey) return;
    // Nothing loaded is not "everything read": without this, `latest` below
    // would stamp a channel the reader has not seen a single message of.
    if (!Number.isFinite(timestampSecs) || timestampSecs <= 0) return;

    const nowSecs = Math.floor(Date.now() / 1000);
    const requested = Math.min(
      timestampSecs,
      nowSecs + CONCORD_READ_MAX_FUTURE_SECS,
    );
    const summary = await channelUnreadSummary(
      identifier.communityId,
      identifier.channelId,
      {
        after: requested,
        nowSecs,
        maxFutureSecs: CONCORD_READ_MAX_FUTURE_SECS,
        selfPubkey: pubkey,
      },
    );
    await markChannelRead(
      pubkey,
      identifier.communityId,
      identifier.channelId,
      Math.max(requested, summary.latest),
    );
  }

  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true,
      supportsThreading: true,
      // Grimoire reads moderation state and honours it; it never issues any.
      // Armada stays the client that bans, kicks, promotes and rotates.
      supportsModeration: false,
      supportsRoles: true,
      supportsGroupManagement: false,
      // A community is joined in Armada. Grimoire enters through the member's
      // own Community List and nothing else.
      canCreateConversations: false,
      // Self-delete only — see {@link deleteMessage}.
      supportsDeletion: true,
      // Messages carry a delivery state and can be retried or discarded; see
      // the module docstring for why reactions and deletes do not.
      supportsDeliveryStatus: true,
      requiresRelay: true,
      // The membership is known and closed, so the composer offers it and
      // nothing else. `resolveConversation` has already narrowed it to whoever
      // can actually open a private channel.
      mentionSuggestions: "roster",
    };
  }

  async sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const identifier = this.identifierOf(conversation);
    const { community, channel, folded } = await this.resolve(identifier);

    // A threaded reply cites its parent's kind, author and root tags, so the
    // parent has to be resolved rather than guessed. It only ever exists in the
    // local store — a Concord reply names a RUMOR id — and failing loudly is
    // right: degrading to an untagged kind-9 would silently post the reply as a
    // new top-level message.
    let replyTo: ReplyParent | undefined;
    if (options?.replyTo) {
      const parent = await this.findRumor(identifier, options.replyTo);
      if (!parent) {
        throw new Error("Can't find the message you're replying to.");
      }
      replyTo = parent;
    }

    const extraTags: string[][] = [
      ...(options?.emojiTags?.map(emojiTag) ?? []),
      ...(options?.blobAttachments?.map(imetaTag) ?? []),
      // NIP-27 mentions, recovered from the rendered content. Sealed in the
      // rumor like every other tag here, so it reaches the channel's members
      // and no relay. The sender is excluded (you cannot mention yourself into
      // a notification) and so is a reply's parent, whom the NIP-22 tags above
      // already name.
      ...extractMentionTags(content, [
        // Empty when no account is active, which `send` refuses a line later.
        accountManager.active$.value?.pubkey ?? "",
        ...(replyTo ? [replyTo.pubkey] : []),
      ]),
    ];

    // Everything that can refuse still throws from here, which is what puts the
    // typed text back in the composer.
    const { built, account } = await this.prepareSend(
      community,
      channel,
      folded,
      {
        content,
        ...(replyTo ? { replyTo } : {}),
        ...(extraTags.length > 0 ? { extraTags } : {}),
      },
    );

    // Queued, and that is what this resolves on. Waiting for the relay would
    // pin the composer for up to the publish timeout and leave no moment at
    // which a "sending" badge could ever be shown.
    const row = await enqueueOutbox({
      pubkey: account.pubkey,
      communityId: community.idHex,
      channel: channel.idHex,
      kind: built.rumor.kind,
      content,
      ...(options?.replyTo ? { replyToId: options.replyTo } : {}),
      ...(extraTags.length > 0 ? { extraTags } : {}),
      createdAt: built.createdAt,
      lastAttemptRumorId: built.rumor.id,
    });
    emitWireScopes([channelScope(channel.idHex)]);

    // Claimed for the whole background attempt: a drain firing while this
    // publish is still open would otherwise rebuild the row under a fresh rumor
    // id and send the same message twice.
    const release = holdOutboxRow(row.id);

    // From here nothing throws to the caller: the message is safe in the
    // outbox, and rethrowing would restore text the reader can already see
    // sitting in the timeline with a badge on it.
    const task = (async () => {
      try {
        // The wrap in hand is this attempt's — freshly built, so there is
        // nothing to rebuild for the FIRST try. Only a later drain rebuilds.
        await publishWrap(community.relays, built.wrap);
      } catch (error) {
        await markOutboxFailed(
          row.id,
          error instanceof Error ? error.message : String(error),
        );
        emitWireScopes([channelScope(channel.idHex)]);
        return;
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
      // Dropped whether or not the store took it. A relay HAS the message, so
      // marking this failed would rebuild and republish it on the next drain —
      // a visible duplicate that the rumor-id dedupe cannot catch, because the
      // rumor never reached the store to be found. The wire echo restores the
      // row instead.
      await removeOutbox(row.id);
      if (!written.ok) {
        console.warn(
          "[concord] sent, but this device could not save it — it will reappear when it is fetched again",
        );
      }
      emitWireScopes([channelScope(channel.idHex)]);
    })();
    this.sending.add(task);
    void task.finally(() => {
      release();
      this.sending.delete(task);
    });
  }

  async sendReaction(
    conversation: Conversation,
    messageId: string,
    emoji: string,
    customEmoji?: EmojiTag,
  ): Promise<void> {
    const identifier = this.identifierOf(conversation);
    const { community, channel, folded } = await this.resolve(identifier);
    const target = await this.findRumor(identifier, messageId);
    if (!target) throw new Error("Can't find the message you're reacting to.");

    // Publish-first end to end, and it throws on failure — no outbox. See the
    // module docstring for why a queued reaction is a different feature.
    const { built, account } = await this.prepareSend(
      community,
      channel,
      folded,
      {
        // A NIP-30 reaction's content is the shortcode; the `emoji` tag carries
        // the image. A plain unicode reaction is its own content.
        content: customEmoji ? `:${customEmoji.shortcode}:` : emoji,
        kind: KIND_REACTION,
        target: messageId,
        targetPubkey: target.pubkey,
        ...(customEmoji ? { extraTags: [emojiTag(customEmoji)] } : {}),
      },
    );
    await this.publishAndStore(community, channel, built, account);
  }

  /**
   * Delete one of the viewer's OWN messages (NIP-09).
   *
   * Self-delete only. Grimoire reads moderation state and honours it but never
   * issues any — deleting someone else's message is a `MANAGE_MESSAGES` action
   * that belongs in Armada, and `foldTimeline` already refuses a delete from an
   * author who does not outrank the target.
   */
  async deleteMessage(
    conversation: Conversation,
    messageId: string,
  ): Promise<void> {
    const identifier = this.identifierOf(conversation);
    const { community, channel, folded } = await this.resolve(identifier);
    const pubkey = accountManager.active$.value?.pubkey;
    const target = await this.findRumor(identifier, messageId);
    if (!target) throw new Error("Can't find the message you're deleting.");
    if (!pubkey || target.pubkey !== pubkey) {
      throw new Error("You can only delete your own messages here.");
    }

    // Publish-first, and it throws: the context menu says "Message deleted" on
    // resolve, so resolving before a relay took the tombstone would be a lie.
    const { built, account } = await this.prepareSend(
      community,
      channel,
      folded,
      {
        content: "",
        kind: KIND_DELETE,
        target: messageId,
        targetKind: target.kind,
      },
    );
    await this.publishAndStore(community, channel, built, account);
  }

  /**
   * Try a queued message again, now.
   *
   * A fresh rumor, not the one that failed — see the outbox docstring. The ring
   * is so the badge flips back to "sending" before the attempt is made rather
   * than after it finishes.
   */
  async retrySend(
    conversation: Conversation,
    messageId: string,
  ): Promise<void> {
    const identifier = this.identifierOf(conversation);
    await retryOutbox(messageId);
    emitWireScopes([channelScope(identifier.channelId)]);
    await drainOutbox();
  }

  /** Give up on a queued message. Nothing was ever published, so nothing leaks. */
  async discardSend(
    conversation: Conversation,
    messageId: string,
  ): Promise<void> {
    const identifier = this.identifierOf(conversation);
    await removeOutbox(messageId);
    emitWireScopes([channelScope(identifier.channelId)]);
  }

  /**
   * A replied-to message is always already in the store: a Concord reply cites a
   * RUMOR id, which exists nowhere else. Nothing to fetch, and no relay to fetch
   * it from — an id we do not hold means a message in a channel or epoch this
   * member cannot read, which is ordinary rather than an error.
   */
  async loadReplyMessage(
    conversation: Conversation,
    pointer: EventPointer | AddressPointer,
  ): Promise<NostrEvent | null> {
    if (!("id" in pointer)) return null;
    const identifier = parseConversationId(conversation.id);
    if (!identifier) return null;
    const hit = await readChannelRumor(
      identifier.communityId,
      identifier.channelId,
      pointer.id,
    );
    return hit ? (toEvent(hit) as NostrEvent) : null;
  }

  cleanup(conversationId: string): void {
    super.cleanup(conversationId);
    this.timelines.get(conversationId)?.complete();
    this.timelines.delete(conversationId);
    this.started.delete(conversationId);
    this.lastEmitted.delete(conversationId);
    this.windows.delete(conversationId);
    this.doorbells.get(conversationId)?.();
    this.doorbells.delete(conversationId);
  }

  cleanupAll(): void {
    super.cleanupAll();
    for (const subject of this.timelines.values()) subject.complete();
    for (const off of this.doorbells.values()) off();
    this.timelines.clear();
    this.started.clear();
    this.lastEmitted.clear();
    this.windows.clear();
    this.doorbells.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * What this channel has waiting for the active account.
   *
   * Two bounded index reads and no fold — the same summary the sidebar hook
   * runs, deliberately, so a snapshot and a live badge can never mean different
   * things. Nobody signed in has nothing unread.
   */
  private async unread(
    identifier: ConcordIdentifier,
    /** The fold's banlist, when the caller already holds it. */
    bannedAuthors?: ReadonlySet<string>,
  ): Promise<ChannelUnread> {
    const pubkey = accountManager.active$.value?.pubkey;
    if (!pubkey) return { count: 0, latest: 0, mention: false, capped: false };
    const after = await readLastRead(
      pubkey,
      identifier.communityId,
      identifier.channelId,
    );
    return channelUnreadSummary(identifier.communityId, identifier.channelId, {
      after,
      nowSecs: Math.floor(Date.now() / 1000),
      maxFutureSecs: CONCORD_READ_MAX_FUTURE_SECS,
      selfPubkey: pubkey,
      ...(bannedAuthors ? { bannedAuthors } : {}),
    });
  }

  /** The community, the channel view, and the control fold behind them. */
  private resolve(identifier: ConcordIdentifier): Promise<ResolvedChannel> {
    // Shared with the outbox drain, which resolves the same channel from a wire
    // doorbell where no adapter exists — see `concord-channel-resolve.ts`.
    return resolveChannel(identifier.communityId, identifier.channelId);
  }

  /**
   * Everything that can refuse a send, and the build itself.
   *
   * Split from the publish so a message can be QUEUED between the two while a
   * reaction or a delete goes straight through. Every failure in here throws,
   * for both paths, and none of them has a side effect to unwind.
   */
  private async prepareSend(
    community: Community,
    channel: Channel,
    folded: FoldedControl,
    opts: Omit<BuildChatSendOptions, "channel" | "pubkey" | "timerSecs">,
  ): Promise<{
    built: Awaited<ReturnType<typeof buildChatSend>>;
    account: { pubkey: string };
  }> {
    const account = accountManager.active$.value;
    if (!account?.pubkey) throw new Error("Sign in to send a message.");
    if (folded.banned.has(account.pubkey)) {
      throw new Error("You have been banned from this community.");
    }
    const kind = opts.replyTo ? KIND_COMMENT : (opts.kind ?? KIND_MESSAGE);
    // A dissolved community honors nothing new (CORD-02 §9: the seal is one-way).
    //
    // ONE CARVE-OUT, and it is the spec's: a member's delete of their own past
    // message is always honored, even post-seal. A self-scrub cannot inject
    // content, and a departing member deserves to erase themselves.
    //
    // Reads the local store only, so it costs no network — and fails OPEN on a
    // store error, matching armada and Vector: an unreadable cache must not
    // block a legitimate send.
    if (kind !== KIND_DELETE) {
      const dead = await dissolvedAt(community.idHex).catch(() => undefined);
      if (dead !== undefined) {
        throw new Error(
          "This community has been dissolved; it accepts nothing new.",
        );
      }
    }
    // Spend the budget BEFORE anything with a side effect, so a refusal leaves
    // nothing signed, published or stored to unwind.
    if (isRateLimitedKind(kind)) {
      const waitMs = consumeSend(community.idHex);
      if (waitMs > 0) throw new SendRateLimitError(waitMs);
    }

    const built = await buildChatSend(
      {
        ...opts,
        channel,
        pubkey: account.pubkey,
        // The timer as folded AT SEND TIME. A fold that has not landed reads as
        // off, and the tag as signed governs — so a client behind the head
        // sends what it knew, rather than guessing.
        timerSecs: messageExpirationOf(folded.metadata),
      },
      account.signer,
    );
    return { built, account: { pubkey: account.pubkey } };
  }

  /**
   * Publish, store, ring — the half that talks to relays.
   *
   * Nothing reaches the store until a relay accepted the wrap, and the doorbell
   * rings only after the write so the re-read finds it.
   */
  private async publishAndStore(
    community: Community,
    channel: Channel,
    built: Awaited<ReturnType<typeof buildChatSend>>,
    account: { pubkey: string },
  ): Promise<void> {
    await publishWrap(community.relays, built.wrap);

    // Accepted somewhere. Store it exactly as an ingested wrap would be, so the
    // row a reload reads back is identical to the one the wire writes when our
    // own wrap comes round again.
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
    // The message IS delivered — a relay took it — but locally invisible, and a
    // silent resolve here would be the same lie publish-first exists to avoid.
    // Say so, and let the composer keep the text.
    if (!written.ok) {
      throw new Error(
        "Sent, but this device could not save it — it may not appear here until it is fetched again.",
      );
    }
    emitWireScopes([channelScope(channel.idHex)]);
  }

  /**
   * One stored rumor of this channel, by id.
   *
   * A direct read, NOT a slice of the timeline: the viewer pages backwards
   * without limit, so a windowed lookup would refuse to reply to, react to, or
   * delete exactly the older messages someone scrolled up to reach.
   */
  private async findRumor(
    identifier: ConcordIdentifier,
    rumorId: string,
  ): Promise<
    { pubkey: string; kind: number; tags: string[][]; id: string } | undefined
  > {
    const hit = await readChannelRumor(
      identifier.communityId,
      identifier.channelId,
      rumorId,
    );
    return hit
      ? {
          id: hit.rumorId,
          pubkey: hit.author,
          kind: hit.kind,
          tags: hit.tags,
        }
      : undefined;
  }

  /** The identifier behind a conversation, or a refusal naming why not. */
  private identifierOf(conversation: Conversation): ConcordIdentifier {
    const identifier = parseConversationId(conversation.id);
    if (!identifier) throw new Error("That is not a Concord conversation.");
    return identifier;
  }

  private async backfill(
    identifier: ConcordIdentifier,
    before?: number,
    onFresh?: () => void,
  ): Promise<void> {
    const { community, channel } = await this.resolve(identifier);
    await syncChannel(community, channel, {
      until: before,
      ...(onFresh ? { onFresh } : {}),
    });
  }

  /**
   * The timeline as the reader should see it: what was delivered, plus what is
   * still trying to be.
   *
   * The queued rows go at the BOTTOM regardless of when they were composed. A
   * failed send from an hour ago sorted into its own place in the history would
   * be buried where nobody would ever find it, and the one thing it needs is to
   * be found.
   */
  private async readMerged(
    identifier: ConcordIdentifier,
    options?: LoadMessagesOptions,
  ): Promise<Message[]> {
    const stored = await this.read(identifier, options);
    const pubkey = accountManager.active$.value?.pubkey;
    if (!pubkey) return stored;
    const queued = await outboxForChannel(
      identifier.communityId,
      identifier.channelId,
      pubkey,
    );
    if (queued.length === 0) return stored;

    // The echo race: a send writes its store row, rings the doorbell, and only
    // then drops its outbox row. A re-read in that window would otherwise show
    // the same message twice — once delivered and once still sending.
    const delivered = new Set(stored.map((m) => m.id));
    const conversationId = conversationIdOf(identifier);
    const pending = queued
      .filter(
        (row) =>
          !(row.lastAttemptRumorId && delivered.has(row.lastAttemptRumorId)),
      )
      .map((row): Message => {
        const event = toEvent({
          rumorId: row.id,
          author: row.pubkey,
          kind: row.kind,
          content: row.content,
          tags: row.extraTags ?? [],
          createdAt: row.createdAt,
        }) as NostrEvent;
        return {
          id: row.id,
          conversationId,
          author: row.pubkey,
          content: row.content,
          timestamp: row.createdAt,
          type: "user" as const,
          ...(row.replyToId ? { replyTo: { id: row.replyToId } } : {}),
          metadata: { encrypted: true },
          protocol: "concord" as const,
          event,
          delivery: row.status,
        };
      });
    return pending.length > 0 ? [...stored, ...pending] : stored;
  }

  /** Read the store, fold, and map to grimoire's `Message` shape. */
  private async read(
    identifier: ConcordIdentifier,
    options?: LoadMessagesOptions,
  ): Promise<Message[]> {
    const { community, channel, folded } = await this.resolve(identifier);
    // Whatever the caller asked for, never less than the reader has paged into
    // view — see {@link windows} for why the callers cannot say so themselves.
    const limit = Math.max(
      options?.limit ?? PAGE_ROWS,
      this.windows.get(conversationIdOf(identifier)) ?? 0,
    );
    const rows = await queryChannelRumors(
      identifier.communityId,
      identifier.channelId,
      {
        limit,
        ...(options?.before !== undefined ? { until: options.before } : {}),
      },
    );

    // The rows carry no epoch — that lives on the wire — so re-attach it from
    // the channel's current stream for the cutoff filter. Rows sealed under a
    // retired epoch were already refused at ingest by the decode path; this is
    // the read-side half, for rows stored before the rotation was adopted.
    const opened: OpenedChat[] = rows.map((row) => ({
      ...row,
      channelIdHex: identifier.channelId,
      epoch: channel.current.epoch,
    }));

    // The SAME wiring local search folds with — see `chatModerationOf`. A
    // search result the timeline would refuse to render is the one failure
    // search cannot have.
    const timeline = foldTimeline(
      filterEpochCutoff(opened, channel),
      chatModerationOf(folded, community.id),
    );

    const conversationId = conversationIdOf(identifier);
    const messages = timeline.messages.map((ev): Message => {
      const parent = parentPointerOf(ev);
      return {
        id: ev.rumorId,
        conversationId,
        author: ev.author,
        content: ev.content,
        timestamp: ev.createdAt,
        type: "user" as const,
        ...(parent ? { replyTo: parent } : {}),
        metadata: {
          encrypted: true,
          // Concord seals reactions inside wraps, so a `#e` relay query can
          // never find them. The fold already tallied them; hand them over as
          // the events the reaction UI expects.
          reactions: reactionEventsFor(ev.rumorId, timeline.reactions),
        },
        protocol: "concord" as const,
        event: toEvent(ev) as NostrEvent,
      };
    });

    // Moderator removals, as rows saying only that a message was here and who
    // took it down. Self-deletes are not in `removed` and never become a row.
    //
    // The event handed over is SCRUBBED — no content, no tags — while the id
    // stays the real rumor id, so React keys and dedupe still work and the
    // withheld text reaches no renderer. The id then no longer hashes its
    // content, which for Concord costs nothing that was not already given up:
    // `toEvent` has always emitted an empty `sig` because a rumor has none and
    // nothing re-verifies. The row carries no raw-event affordance, so the
    // scrubbed event is never surfaced — but a future generic "view raw event"
    // over `Message.event` would have to special-case a deleted row.
    const tombstones = timeline.removed.map(({ target, deleter }): Message => ({
      id: target.rumorId,
      conversationId,
      author: target.author,
      content: "",
      timestamp: target.createdAt,
      // "user", not "system", deliberately: `groupSystemMessages` collapses
      // only system rows, and a tombstone that could be grouped away would
      // take a jump target with it.
      type: "user" as const,
      metadata: { encrypted: true, deleted: true, deletedBy: deleter },
      protocol: "concord" as const,
      event: toEvent({ ...target, content: "", tags: [] }) as NostrEvent,
    }));
    if (tombstones.length === 0) return messages;
    return [...messages, ...tombstones].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }
}

/** A NIP-30 `emoji` tag: shortcode, image, and the set it came from. */
function emojiTag(emoji: EmojiTag): string[] {
  return [
    "emoji",
    emoji.shortcode,
    emoji.url,
    ...(emoji.address ? [emoji.address] : []),
  ];
}

/** A NIP-92 `imeta` tag for one attachment, in the shape other clients read. */
export function imetaTag(blob: BlobAttachmentMeta): string[] {
  const parts = [`url ${blob.url}`];
  // For an encrypted upload the server's `m`, `x` and `size` all describe the
  // CIPHERTEXT. `m` is the one that matters to a reader deciding what it is
  // about to render, so the plaintext's own type wins where we know it.
  const mime = blob.originalMime ?? blob.mimeType;
  if (mime) parts.push(`m ${mime}`);
  if (blob.sha256) parts.push(`x ${blob.sha256}`);
  if (blob.size !== undefined) parts.push(`size ${blob.size}`);
  if (blob.encryption) {
    // Vector / 0xChat's field names, which is what makes the blob readable by
    // armada and by them. The key travels with the message because the message
    // is already sealed to the members who may see it.
    parts.push(`encryption-algorithm ${blob.encryption.algorithm}`);
    parts.push(`decryption-key ${blob.encryption.key}`);
    parts.push(`decryption-nonce ${blob.encryption.nonce}`);
    parts.push(`ox ${blob.encryption.ox}`);
  }
  return ["imeta", ...parts];
}

/**
 * The message a rumor is a reply to, as an event pointer.
 *
 * Two distinct shapes, and conflating them is a rendering bug in every other
 * client: a NIP-22 kind-1111 comment names its IMMEDIATE parent in the
 * lowercase `e` tag (the uppercase `E` is the thread root, which is not what a
 * reply preview should show), while a kind-9 message uses `q` for an INLINE
 * quote-reply per NIP-C7. Both are rumor ids, so no relay hint is meaningful —
 * the target exists nowhere but this member's own store.
 */
function parentPointerOf(ev: {
  kind: number;
  tags: string[][];
}): EventPointer | undefined {
  const tag =
    ev.kind === KIND_COMMENT
      ? ev.tags.find((t) => t[0] === "e" && t[1])
      : ev.tags.find((t) => t[0] === "q" && t[1]);
  if (!tag) return undefined;
  return { id: tag[1], ...(tag[3] ? { author: tag[3] } : {}) };
}

/**
 * The fold's reaction tally for one message, as the kind-7 events the reaction
 * UI aggregates.
 *
 * Synthesized rather than stored: the fold has already deduped per reactor and
 * resolved deletes, so re-deriving from raw rows would undo that work. The ids
 * are the real reaction rumor ids, so a later self-delete still matches.
 */
function reactionEventsFor(
  targetId: string,
  reactions: Map<string, Map<string, ReactionEntry>>,
): NostrEvent[] | undefined {
  const byEmoji = reactions.get(targetId);
  if (!byEmoji || byEmoji.size === 0) return undefined;
  const out: NostrEvent[] = [];
  for (const [emoji, entry] of byEmoji) {
    for (const [pubkey, rumorId] of entry.reactors) {
      out.push({
        id: rumorId,
        pubkey,
        kind: 7,
        content: entry.url ? `:${emoji}:` : emoji,
        tags: [
          ["e", targetId],
          ...(entry.url ? [["emoji", emoji, entry.url]] : []),
        ],
        created_at: 0,
        sig: "",
      } as NostrEvent);
    }
  }
  return out;
}

/**
 * A stored rumor as grimoire's renderers expect an event.
 *
 * `sig` is empty and stays empty: a rumor has none by construction — authorship
 * was proved by the seal signature at ingest (CORD-01) — and inventing one would
 * claim a proof that does not exist. Every renderer here reads content, tags,
 * kind and pubkey; nothing re-verifies.
 */
function toEvent(ev: {
  rumorId: string;
  author: string;
  kind: number;
  content: string;
  tags: string[][];
  createdAt: number;
}) {
  return {
    id: ev.rumorId,
    pubkey: ev.author,
    kind: ev.kind,
    content: ev.content,
    tags: ev.tags,
    created_at: ev.createdAt,
    sig: "",
  };
}
