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
 * the store. Armada is optimistic instead — it renders the message before the
 * seal and flips it to a retryable "failed" badge — because a NIP-46 seal is a
 * remote round-trip that can take seconds. Grimoire has no failed-state or retry
 * affordance, and a message sitting in the local store that no relay ever took
 * is a lie the reader cannot see through. So nothing is written until a relay
 * accepted it, and a failure throws with nothing to reconcile. A deliberate
 * divergence, narrowing.
 */

import { Observable, ReplaySubject } from "rxjs";
import type { AddressPointer, EventPointer } from "nostr-tools/nip19";

import {
  foldTimeline,
  type OpenedChat,
  type ReactionEntry,
} from "@/lib/concord/chat";
import { filterEpochCutoff } from "@/lib/concord/chat";
import { channelsView } from "@/lib/concord/channels";
import { KIND_COMMENT } from "@/lib/concord/kinds";
import type { BlobAttachmentMeta } from "./base-adapter";
import { citationSatisfied, type FoldedControl } from "@/lib/concord/control";
import type { Channel, Community } from "@/lib/concord/types";
import { channelScope, onWireScope } from "@/lib/concord/wire-bus";
import { canActOnMember, isAuthorized, Permissions } from "@/lib/concord/roles";
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
import { extractMentionTags } from "@/lib/concord/mentions";
import { emitWireScopes } from "@/lib/concord/wire-bus";
import { syncChannel } from "@/services/concord-channel-sync";
import { publishWrap } from "@/services/concord-publish";
import { loadStoredCommunities } from "@/services/concord-communities";
import { dissolvedAt } from "@/services/concord-dissolution";
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
import { foldStoredControl } from "@/services/concord-state";
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
      },
      // A SNAPSHOT, taken as the channel opens — `Conversation` is resolved
      // once and does not re-resolve when a message lands. Live badges come
      // from `useConcordUnread`, which re-runs the same summary off Dexie.
      // Both paths share `channelUnreadSummary`, so they can be stale relative
      // to one another but never disagree about what "unread" means.
      unreadCount: (await this.unread(identifier)).count,
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
        void this.read(identifier, options)
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
        const stored = await this.read(identifier, options);
        if (stored.length > 0) this.publish(conversation.id, emitter, stored);
        // Repaint as each relay lands, not once at the end: the first relay to
        // answer is what the reader is waiting for, and `publish` stays silent
        // when a page added nothing new.
        await this.backfill(identifier, undefined, () => {
          void this.read(identifier, options).then((next) =>
            this.publish(conversation.id, emitter, next),
          );
        });
        // After the backfill an empty answer IS the answer: the channel is
        // empty, and saying so is now honest.
        this.publish(
          conversation.id,
          emitter,
          await this.read(identifier, options),
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
    const signature = next.map((m) => m.id).join(",");
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
      const next = await this.read(identifier);
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
    return widened.filter((m) => m.timestamp < before);
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
      requiresRelay: true,
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

    await this.send(community, channel, folded, {
      content,
      ...(replyTo ? { replyTo } : {}),
      ...(extraTags.length > 0 ? { extraTags } : {}),
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

    await this.send(community, channel, folded, {
      // A NIP-30 reaction's content is the shortcode; the `emoji` tag carries
      // the image. A plain unicode reaction is its own content.
      content: customEmoji ? `:${customEmoji.shortcode}:` : emoji,
      kind: KIND_REACTION,
      target: messageId,
      targetPubkey: target.pubkey,
      ...(customEmoji ? { extraTags: [emojiTag(customEmoji)] } : {}),
    });
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

    await this.send(community, channel, folded, {
      content: "",
      kind: KIND_DELETE,
      target: messageId,
      targetKind: target.kind,
    });
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
  private async unread(identifier: ConcordIdentifier): Promise<ChannelUnread> {
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
    });
  }

  /** The community, the channel view, and the control fold behind them. */
  private async resolve(identifier: ConcordIdentifier): Promise<{
    community: Community;
    channel: Channel;
    folded: FoldedControl;
  }> {
    const pubkey = accountManager.active$.value?.pubkey;
    if (!pubkey) throw new Error("No active account");

    const communities = await loadStoredCommunities(pubkey);
    const community = communities.find(
      (c) => c.idHex === identifier.communityId,
    );
    if (!community) {
      throw new Error("That community is not in your Community List");
    }
    const folded = await foldStoredControl(community);
    if (!folded) {
      // A Refounded community whose compaction snapshot has not been recorded
      // yet. Folding by old-root contiguity would anchor on a superseded
      // fragment, so there is nothing safe to resolve against.
      throw new Error(
        "Still catching up with this community — try again in a moment.",
      );
    }
    const channel = channelsView(community, folded).find(
      (ch) => ch.idHex === identifier.channelId,
    );
    if (!channel) {
      // Either the channel was deleted, or it is private and this member holds
      // no key for it. Both read the same from here, and both mean the same
      // thing to the reader: there is nothing to show.
      throw new Error("That channel is not readable with the keys you hold");
    }
    return { community, channel, folded };
  }

  /**
   * Build, seal, wrap, publish, store, ring.
   *
   * The order matters: nothing reaches the store until a relay accepted the
   * wrap (see the module docstring), and the doorbell rings only after the write
   * so the re-read finds it.
   */
  private async send(
    community: Community,
    channel: Channel,
    folded: FoldedControl,
    opts: Omit<BuildChatSendOptions, "channel" | "pubkey" | "timerSecs">,
  ): Promise<void> {
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

    const timeline = foldTimeline(filterEpochCutoff(opened, channel), {
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
        citationSatisfied(folded, community.id, deleter, action?.citation),
      canSetTimer: (author) =>
        isAuthorized(
          folded.roster,
          author,
          folded.ownerHex,
          Permissions.MANAGE_METADATA,
        ),
    });

    const conversationId = conversationIdOf(identifier);
    return timeline.messages.map((ev) => {
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
