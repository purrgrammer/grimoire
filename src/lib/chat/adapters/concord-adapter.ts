/**
 * Concord chat adapter — one channel of one community (CORD-03).
 *
 * Unlike every other adapter here, this one does NOT subscribe to relays for
 * messages. Concord traffic is opaque kind-1059 wraps, so a wrap is decrypted
 * once at ingest and the recovered rumor is stored; the timeline then reads back
 * out of Dexie as an ordinary indexed query with no crypto. `loadMessages`
 * therefore emits from the STORE and kicks a backfill alongside it.
 *
 * The read half only: `sendMessage` and `sendReaction` land in phase 6. They
 * throw for now rather than no-op, so a composer wired up early fails loudly
 * instead of silently swallowing a message.
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
import { citationSatisfied, type FoldedControl } from "@/lib/concord/control";
import type { Channel, Community } from "@/lib/concord/types";
import { canActOnMember, isAuthorized, Permissions } from "@/lib/concord/roles";
import { syncChannel } from "@/services/concord-channel-sync";
import { loadStoredCommunities } from "@/services/concord-communities";
import { queryChannelRumors } from "@/services/concord-rumor-store";
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
    const participants: Participant[] = [
      { pubkey: folded.ownerHex, role: "admin" },
    ];

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
      unreadCount: 0,
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

  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const identifier = parseConversationId(conversation.id);
    if (!identifier) return [];
    // Backfill the relays BELOW the oldest row we hold, then re-read the store:
    // the page the caller wants may only exist on the wire.
    await this.backfill(identifier, before);
    return this.read(identifier, { before });
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
      requiresRelay: true,
    };
  }

  async sendMessage(
    _conversation: Conversation,
    _content: string,
    _options?: SendMessageOptions,
  ): Promise<void> {
    throw new Error("Sending to a Concord channel is not wired up yet.");
  }

  async sendReaction(
    _conversation: Conversation,
    _messageId: string,
    _emoji: string,
    _customEmoji?: EmojiTag,
  ): Promise<void> {
    throw new Error("Reacting in a Concord channel is not wired up yet.");
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
    const rows = await queryChannelRumors(
      identifier.communityId,
      identifier.channelId,
      { limit: PAGE_ROWS * 4 },
    );
    const hit = rows.find((row) => row.rumorId === pointer.id);
    return hit ? (toEvent(hit) as NostrEvent) : null;
  }

  cleanup(conversationId: string): void {
    super.cleanup(conversationId);
    this.timelines.get(conversationId)?.complete();
    this.timelines.delete(conversationId);
    this.started.delete(conversationId);
    this.lastEmitted.delete(conversationId);
  }

  cleanupAll(): void {
    super.cleanupAll();
    for (const subject of this.timelines.values()) subject.complete();
    this.timelines.clear();
    this.started.clear();
    this.lastEmitted.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

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
    const rows = await queryChannelRumors(
      identifier.communityId,
      identifier.channelId,
      {
        limit: options?.limit ?? PAGE_ROWS,
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
