import {
  Observable,
  firstValueFrom,
  combineLatest,
  timeout as rxTimeout,
  of,
} from "rxjs";
import { map, first, toArray, catchError } from "rxjs/operators";
import type { Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import {
  ChatProtocolAdapter,
  type SendMessageOptions,
  type ZapConfig,
} from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
  Participant,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import {
  toApplesauceEmoji,
  toApplesauceEmojis,
  type EmojiTag,
} from "@/lib/emoji-helpers";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { requestEvents } from "@/lib/relay-subscription";
import { publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import { settingsManager } from "@/services/settings";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";
import { selectRelaysForCommentThread } from "@/services/relay-selection";
import { mergeRelaySets } from "applesauce-core/helpers";
import {
  createReplaceableAddress,
  isAddressableKind,
  getTagValue,
} from "applesauce-core/helpers/event";
import { getOutboxes } from "applesauce-core/helpers/mailboxes";
import { getEventPointerFromETag } from "applesauce-core/helpers/pointers";

import {
  getCommentRootPointer,
  getCommentReplyPointer,
  isCommentEventPointer,
  isCommentAddressPointer,
  type CommentPointer,
} from "applesauce-common/helpers/comment";
import {
  getZapAmount,
  getZapSender,
  getZapRecipient,
} from "applesauce-common/helpers";
import { CommentFactory, ReactionFactory } from "applesauce-common/factories";
import {
  getExternalIdentifierLabel,
  inferExternalIdentifierType,
} from "@/lib/nip73-helpers";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * NIP-22 Adapter - Comment Threading for Any Event Kind
 *
 * Catch-all adapter for NIP-22 (kind 1111) comment threads.
 * Handles any event kind not claimed by other adapters (NIP-10, NIP-29, NIP-53).
 *
 * Features:
 * - Comment on any Nostr event (articles, git issues, highlights, etc.)
 * - Comment on external identifiers (URLs, hashtags, podcast GUIDs)
 * - Dynamic root resolution (kind 1111 events trace back to actual root)
 * - Kind-aware relay selection (e.g., NIP-34 git events use repo relays)
 * - Full NIP-22 tag structure (uppercase root, lowercase parent)
 *
 * Identifier formats:
 * - nevent1... (non-kind-1, non-kind-30311 events)
 * - naddr1... (non-kind-30311, non-NIP-29 addressable events)
 * - https://... or http://... (external URL)
 * - #hashtag (hashtag comment thread)
 */
export class Nip22Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-22" as const;
  readonly type = "comment-thread" as const;

  /**
   * Parse identifier - accepts non-kind-1 nevent, non-NIP-29/53 naddr, URLs, hashtags
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // URL support
    if (input.startsWith("http://") || input.startsWith("https://")) {
      return {
        type: "comment",
        value: { external: input },
        relays: [],
      };
    }

    // Hashtag support — store as NIP-73 format: "#<tag>"
    if (input.startsWith("#") && !input.startsWith("#[")) {
      const tag = input.slice(1).toLowerCase();
      if (tag.length > 0) {
        return {
          type: "comment",
          value: { external: `#${tag}` },
          relays: [],
        };
      }
    }

    // nevent format
    if (input.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nevent") {
          const { id, relays, author, kind } = decoded.data;

          // Only accept if kind is explicitly set and NOT kind 1 (NIP-10) or 30311 (NIP-53)
          // If kind is undefined, return null — handled by parser fetch-then-dispatch
          if (kind === undefined) return null;
          if (kind === 1) return null;
          if (kind === 30311) return null;

          return {
            type: "comment",
            value: { eventId: id, relays, author, kind },
            relays: relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    // Generic NIP-73 external identifiers (iso3166:ES, podcast:guid:..., isbn:..., etc.)
    const externalType = inferExternalIdentifierType(input);
    if (externalType !== "web") {
      return {
        type: "comment",
        value: { external: input },
        relays: [],
      };
    }

    // naddr format
    if (input.startsWith("naddr1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "naddr") {
          const { kind, pubkey, identifier, relays } = decoded.data;

          // Reject kinds handled by other adapters
          if (kind === 30311) return null; // NIP-53
          if (kind === 10009) return null; // Group list
          if (kind >= 39000 && kind <= 39002) return null; // NIP-29 group metadata

          return {
            type: "comment",
            value: {
              address: { kind, pubkey, identifier },
              relays,
              kind,
            },
            relays: relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Resolve conversation from comment identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (identifier.type !== "comment") {
      throw new Error(
        `NIP-22 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const relayHints = identifier.relays || [];

    // --- External roots (URL, hashtag) ---
    if (identifier.value.external) {
      return this.resolveExternalConversation(
        identifier.value.external,
        relayHints,
      );
    }

    // --- Address roots (naddr) ---
    if (identifier.value.address) {
      return this.resolveAddressConversation(
        identifier.value.address,
        relayHints,
      );
    }

    // --- Event roots (nevent) ---
    if (identifier.value.eventId) {
      return this.resolveEventConversation(
        identifier.value.eventId,
        relayHints,
        identifier.value.author,
        identifier.value.kind,
      );
    }

    throw new Error("NIP-22: identifier has no event, address, or external");
  }

  /**
   * Resolve external identifier conversation (URL, hashtag)
   */
  private async resolveExternalConversation(
    external: string,
    relayHints: string[],
  ): Promise<Conversation> {
    // Determine the K tag value from the external identifier
    const rootKind = this.getExternalKindTag(external);
    const title = getExternalIdentifierLabel(external, rootKind);
    const conversationId = `nip-22:i:${external}`;

    // Use user's read relays + hints for external identifier threads
    const relays = await selectRelaysForCommentThread(null, null, relayHints);

    return {
      id: conversationId,
      type: "comment-thread",
      protocol: "nip-22",
      title,
      participants: [],
      metadata: {
        commentRootType: "external",
        commentRootExternal: external,
        commentRootKind: rootKind,
        relays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Resolve addressable event conversation (naddr)
   */
  private async resolveAddressConversation(
    address: { kind: number; pubkey: string; identifier: string },
    relayHints: string[],
  ): Promise<Conversation> {
    // Try to fetch the addressable event for metadata
    const rootEvent = await firstValueFrom(
      eventStore.replaceable(address.kind, address.pubkey, address.identifier),
      { defaultValue: undefined },
    );

    // If not in store, try fetching from relays
    let fetchedEvent = rootEvent;
    if (!fetchedEvent && relayHints.length > 0) {
      const filter: Filter = {
        kinds: [address.kind],
        authors: [address.pubkey],
        "#d": [address.identifier],
        limit: 1,
      };
      const events = await requestEvents(
        relayHints.length > 0 ? relayHints : AGGREGATOR_RELAYS,
        [filter],
      );
      fetchedEvent = events[0];
    }

    const aTag = createReplaceableAddress(
      address.kind,
      address.pubkey,
      address.identifier,
    );
    const conversationId = `nip-22:a:${aTag}`;

    // Extract title from event or use kind + identifier
    const title = fetchedEvent
      ? this.extractTitle(fetchedEvent)
      : `${address.kind}:${address.identifier}`;

    const relays = await selectRelaysForCommentThread(
      fetchedEvent || null,
      address.kind,
      relayHints,
    );

    const participants: Participant[] = [
      { pubkey: address.pubkey, role: "op" },
    ];

    return {
      id: conversationId,
      type: "comment-thread",
      protocol: "nip-22",
      title,
      participants,
      metadata: {
        commentRootType: "address",
        commentRootEventId: fetchedEvent?.id,
        commentRootAddress: address,
        commentRootKind: String(address.kind),
        relays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Resolve event-based conversation (nevent)
   * If the event is kind 1111, traces up to the actual root
   */
  private async resolveEventConversation(
    eventId: string,
    relayHints: string[],
    _authorHint?: string,
    _kindHint?: number,
  ): Promise<Conversation> {
    // Fetch the provided event
    const providedEvent = await this.fetchEvent(eventId, relayHints);
    if (!providedEvent) {
      throw new Error("Event not found");
    }

    // If this is a kind 1111 comment, trace to the actual root
    if (providedEvent.kind === 1111) {
      return this.resolveFromComment(providedEvent, relayHints);
    }

    // This event IS the root
    const conversationId = this.getConversationIdForEvent(providedEvent);

    const title = this.extractTitle(providedEvent);
    const relays = await selectRelaysForCommentThread(
      providedEvent,
      providedEvent.kind,
      relayHints,
    );

    const participants: Participant[] = [
      { pubkey: providedEvent.pubkey, role: "op" },
    ];

    // Check if this is an addressable event — store address metadata too
    const isAddressable = isAddressableKind(providedEvent.kind);
    const dTag = isAddressable ? getTagValue(providedEvent, "d") : undefined;

    return {
      id: conversationId,
      type: "comment-thread",
      protocol: "nip-22",
      title,
      participants,
      metadata: {
        commentRootType: isAddressable ? "address" : "event",
        commentRootEventId: providedEvent.id,
        commentRootAddress:
          isAddressable && dTag !== undefined
            ? {
                kind: providedEvent.kind,
                pubkey: providedEvent.pubkey,
                identifier: dTag,
              }
            : undefined,
        commentRootKind: String(providedEvent.kind),
        relays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Resolve conversation from a kind 1111 comment event by tracing to root
   */
  private async resolveFromComment(
    commentEvent: NostrEvent,
    relayHints: string[],
  ): Promise<Conversation> {
    const rootPointer = getCommentRootPointer(commentEvent);
    if (!rootPointer) {
      throw new Error("NIP-22 comment missing root pointer");
    }

    if (isCommentEventPointer(rootPointer)) {
      return this.resolveEventConversation(
        rootPointer.id,
        rootPointer.relay ? [rootPointer.relay, ...relayHints] : relayHints,
        rootPointer.pubkey,
        rootPointer.kind,
      );
    }

    if (isCommentAddressPointer(rootPointer)) {
      const hints = rootPointer.relay
        ? [rootPointer.relay, ...relayHints]
        : relayHints;
      return this.resolveAddressConversation(
        {
          kind: rootPointer.kind,
          pubkey: rootPointer.pubkey,
          identifier: rootPointer.identifier,
        },
        hints,
      );
    }

    // External pointer
    if (rootPointer.type === "external") {
      return this.resolveExternalConversation(
        rootPointer.identifier,
        relayHints,
      );
    }

    throw new Error("NIP-22: unknown root pointer type");
  }

  /**
   * Load messages for a comment thread
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const meta = conversation.metadata;
    const relays = meta?.relays || [];
    const conversationId = conversation.id;
    const rootType = meta?.commentRootType;

    // Build comment filter based on root type
    const commentFilter = this.buildCommentFilter(conversation, options);
    const filters: Filter[] = [commentFilter];

    // Add interaction filters on root event
    if (rootType === "event" && meta?.commentRootEventId) {
      const rootId = meta.commentRootEventId;
      filters.push(
        { kinds: [7], "#e": [rootId], limit: 200 },
        { kinds: [9735], "#e": [rootId], limit: 100 },
        { kinds: [16], "#e": [rootId], limit: 100 },
      );
    } else if (rootType === "address" && meta?.commentRootAddress) {
      const aTag = createReplaceableAddress(
        meta.commentRootAddress.kind,
        meta.commentRootAddress.pubkey,
        meta.commentRootAddress.identifier,
      );
      filters.push(
        { kinds: [7], "#a": [aTag], limit: 200 },
        { kinds: [9735], "#a": [aTag], limit: 100 },
        { kinds: [16], "#a": [aTag], limit: 100 },
      );
    }

    // Clean up existing subscription
    this.cleanup(conversationId);

    // Start persistent subscription
    const subscription = pool
      .subscription(relays, filters, { eventStore })
      .subscribe({
        next: () => {
          // Events handled by EventStore
        },
      });

    this.subscriptions.set(conversationId, subscription);

    // Build comment filter (kind 1111 with uppercase root tags)
    const commentTimelineFilter = this.buildEventStoreFilter(conversation);
    const comments$ = eventStore.timeline(commentTimelineFilter);

    // Build interactions filter (zaps/reposts on root, using lowercase tags)
    const interactions$ = this.buildInteractionsObservable(conversation);

    // For event/address roots, include the root event in the stream
    if (
      (rootType === "event" || rootType === "address") &&
      meta?.commentRootEventId
    ) {
      const rootEvent$ = eventStore.event(meta.commentRootEventId);
      const sources = interactions$
        ? [rootEvent$, comments$, interactions$]
        : [rootEvent$, comments$];

      return combineLatest(sources).pipe(
        map((results) => {
          const messages: Message[] = [];
          const rootEvent = results[0] as NostrEvent | undefined;
          const commentEvents = results[1] as NostrEvent[];
          const interactionEvents = (results[2] as NostrEvent[]) || [];

          if (rootEvent) {
            messages.push(this.rootEventToMessage(rootEvent, conversationId));
          }

          for (const event of commentEvents) {
            const msg = this.eventToMessage(event, conversationId, meta);
            if (msg) messages.push(msg);
          }

          for (const event of interactionEvents) {
            const msg = this.eventToMessage(event, conversationId, meta);
            if (msg) messages.push(msg);
          }

          return messages.sort((a, b) => a.timestamp - b.timestamp);
        }),
      );
    }

    // External roots or address roots without event ID
    const toMessages = (events: NostrEvent[]): Message[] =>
      events
        .map((event) => this.eventToMessage(event, conversationId, meta))
        .filter((msg): msg is Message => msg !== null);

    if (interactions$) {
      return combineLatest([comments$, interactions$]).pipe(
        map(([commentEvents, interactionEvents]) =>
          [...toMessages(commentEvents), ...toMessages(interactionEvents)].sort(
            (a, b) => a.timestamp - b.timestamp,
          ),
        ),
      );
    }

    return comments$.pipe(
      map((commentEvents) =>
        toMessages(commentEvents).sort((a, b) => a.timestamp - b.timestamp),
      ),
    );
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const meta = conversation.metadata;
    const relays = meta?.relays || [];

    const commentFilter = this.buildCommentFilter(conversation, {
      before,
      limit: 50,
    });

    const events = await requestEvents(relays, [commentFilter]);

    const messages = events
      .map((event) => this.eventToMessage(event, conversation.id, meta))
      .filter((msg): msg is Message => msg !== null);

    return messages.reverse();
  }

  /**
   * Send a comment to the thread
   */
  async sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const meta = conversation.metadata;
    const relays = meta?.relays || [];

    // Determine parent event
    let parentEvent: NostrEvent | undefined;

    if (options?.replyTo) {
      // Replying to a specific comment
      parentEvent = await firstValueFrom(eventStore.event(options.replyTo), {
        defaultValue: undefined,
      });
      if (!parentEvent) {
        throw new Error("Parent comment event not found");
      }
    } else if (meta?.commentRootEventId) {
      // Top-level comment on the root event
      parentEvent = await firstValueFrom(
        eventStore.event(meta.commentRootEventId),
        { defaultValue: undefined },
      );
      if (!parentEvent) {
        throw new Error("Root event not found in store");
      }
    }

    const commentOptions = {
      emojis: options?.emojiTags
        ? toApplesauceEmojis(options.emojiTags)
        : undefined,
    };

    let draft;
    if (parentEvent) {
      // CommentFactory with the parent event
      draft = CommentFactory.create(parentEvent, content, commentOptions);
    } else if (meta?.commentRootExternal) {
      // External root — create CommentPointer
      const pointer = this.buildExternalCommentPointer(meta);
      if (!pointer) {
        throw new Error("Cannot build comment pointer for external root");
      }
      draft = CommentFactory.create(pointer, content, commentOptions);
    } else {
      throw new Error("No parent event or external root available");
    }

    // Tags applesauce doesn't generate for us
    const extraTags: string[][] = [];

    // Add NIP-92 imeta tags for blob attachments
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        extraTags.push(["imeta", ...imetaParts]);
      }
    }

    // Add client tag if enabled
    if (settingsManager.getSetting("post", "includeClientTag")) {
      extraTags.push(GRIMOIRE_CLIENT_TAG);
    }

    const event = await draft
      .modifyPublicTags((tags) => [...tags, ...extraTags])
      .sign(activeSigner);
    await publishEventToRelays(event, relays);
  }

  /**
   * Send a reaction to a message
   */
  async sendReaction(
    conversation: Conversation,
    messageId: string,
    emoji: string,
    customEmoji?: EmojiTag,
  ): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const relays = conversation.metadata?.relays || [];

    const messageEvent = await firstValueFrom(eventStore.event(messageId), {
      defaultValue: undefined,
    });

    if (!messageEvent) {
      throw new Error("Message event not found");
    }

    const emojiArg = customEmoji ? toApplesauceEmoji(customEmoji) : emoji;

    const event = await ReactionFactory.create(messageEvent, emojiArg)
      .modifyPublicTags((tags) =>
        settingsManager.getSetting("post", "includeClientTag")
          ? [...tags, GRIMOIRE_CLIENT_TAG]
          : tags,
      )
      .sign(activeSigner);
    await publishEventToRelays(event, relays);
  }

  /**
   * Get zap configuration for a message
   */
  getZapConfig(message: Message, conversation: Conversation): ZapConfig {
    const relays = conversation.metadata?.relays || [];

    return {
      supported: true,
      recipientPubkey: message.author,
      eventPointer: {
        id: message.id,
        author: message.author,
        relays,
      },
      relays,
    };
  }

  /**
   * Load a replied-to message by pointer
   */
  async loadReplyMessage(
    conversation: Conversation,
    pointer: EventPointer | AddressPointer,
  ): Promise<NostrEvent | null> {
    const eventId = "id" in pointer ? pointer.id : null;

    if (!eventId) {
      console.warn(
        "[NIP-22] AddressPointer not supported for loadReplyMessage",
      );
      return null;
    }

    // Check EventStore first
    const cachedEvent = await eventStore
      .event(eventId)
      .pipe(first())
      .toPromise();
    if (cachedEvent) return cachedEvent;

    // Fetch from relays
    const conversationRelays = conversation.metadata?.relays || [];
    const relays = mergeRelaySets(conversationRelays, pointer.relays || []);

    if (relays.length === 0) return null;

    const filter: Filter = { ids: [eventId], limit: 1 };
    const events = await requestEvents(relays, [filter]);

    return events[0] || null;
  }

  /**
   * Get capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false,
      supportsThreading: true,
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      canCreateConversations: false,
      requiresRelay: false,
    };
  }

  // --- Private helpers ---

  /**
   * Build relay filter for comments based on root type
   */
  private buildCommentFilter(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Filter {
    const meta = conversation.metadata;
    const filter: Filter = {
      kinds: [1111],
      limit: options?.limit || 100,
    };

    if (options?.before) filter.until = options.before;
    if (options?.after) filter.since = options.after;

    if (meta?.commentRootType === "event" && meta?.commentRootEventId) {
      filter["#E"] = [meta.commentRootEventId];
    } else if (
      meta?.commentRootType === "address" &&
      meta?.commentRootAddress
    ) {
      const aTag = createReplaceableAddress(
        meta.commentRootAddress.kind,
        meta.commentRootAddress.pubkey,
        meta.commentRootAddress.identifier,
      );
      filter["#A"] = [aTag];
    } else if (
      meta?.commentRootType === "external" &&
      meta?.commentRootExternal
    ) {
      filter["#I"] = [meta.commentRootExternal];
    }

    return filter;
  }

  /**
   * Build EventStore timeline filter for comments (kind 1111 only).
   * Comments use uppercase tags (#E/#A/#I) per NIP-22.
   */
  private buildEventStoreFilter(conversation: Conversation): Filter {
    const meta = conversation.metadata;

    if (meta?.commentRootType === "event" && meta?.commentRootEventId) {
      return { kinds: [1111], "#E": [meta.commentRootEventId] };
    }

    if (meta?.commentRootType === "address" && meta?.commentRootAddress) {
      const aTag = createReplaceableAddress(
        meta.commentRootAddress.kind,
        meta.commentRootAddress.pubkey,
        meta.commentRootAddress.identifier,
      );
      return { kinds: [1111], "#A": [aTag] };
    }

    if (meta?.commentRootType === "external" && meta?.commentRootExternal) {
      return { kinds: [1111], "#I": [meta.commentRootExternal] };
    }

    return { kinds: [1111] };
  }

  /**
   * Build observable for interactions on the root (zaps, reposts).
   * These use lowercase tags (#e/#a) unlike comments which use uppercase.
   * Returns null for external roots (no event to interact with).
   */
  private buildInteractionsObservable(
    conversation: Conversation,
  ): Observable<NostrEvent[]> | null {
    const meta = conversation.metadata;

    if (meta?.commentRootType === "event" && meta?.commentRootEventId) {
      return eventStore.timeline({
        kinds: [9735, 16],
        "#e": [meta.commentRootEventId],
      });
    }

    if (meta?.commentRootType === "address" && meta?.commentRootAddress) {
      const aTag = createReplaceableAddress(
        meta.commentRootAddress.kind,
        meta.commentRootAddress.pubkey,
        meta.commentRootAddress.identifier,
      );
      return eventStore.timeline({
        kinds: [9735, 16],
        "#a": [aTag],
      });
    }

    return null;
  }

  /**
   * Get conversation ID for an event root
   */
  private getConversationIdForEvent(event: NostrEvent): string {
    if (isAddressableKind(event.kind)) {
      const dTag = getTagValue(event, "d") || "";
      const aTag = createReplaceableAddress(event.kind, event.pubkey, dTag);
      return `nip-22:a:${aTag}`;
    }
    return `nip-22:e:${event.id}`;
  }

  /**
   * Get NIP-73 K tag value for external identifiers
   */
  private getExternalKindTag(external: string): string {
    if (external.startsWith("http://") || external.startsWith("https://")) {
      return "web";
    }
    if (external.startsWith("#")) {
      return "#";
    }
    // Use inferExternalIdentifierType for other NIP-73 formats
    return inferExternalIdentifierType(external);
  }

  /**
   * Build CommentPointer for external roots
   */
  private buildExternalCommentPointer(
    meta: Conversation["metadata"],
  ): CommentPointer | null {
    if (!meta?.commentRootExternal || !meta?.commentRootKind) return null;

    // Build a CommentExternalPointer
    // The applesauce type expects { type: "external", kind: string, identifier: string }
    return {
      type: "external",
      kind: meta.commentRootKind,
      identifier: meta.commentRootExternal,
    } as CommentPointer;
  }

  /**
   * Extract title from root event
   */
  private extractTitle(event: NostrEvent): string {
    // Try common title tags
    const title =
      getTagValue(event, "title") ||
      getTagValue(event, "name") ||
      getTagValue(event, "subject");
    if (title) {
      return title.length <= 60 ? title : title.slice(0, 57) + "...";
    }

    // Fall back to content
    const content = event.content.trim();
    if (!content) return `Comments on ${event.kind}`;

    const firstLine = content.split("\n")[0];
    if (firstLine && firstLine.length <= 50) return firstLine;
    if (content.length <= 50) return content;
    return content.slice(0, 47) + "...";
  }

  /**
   * Convert root event to first Message
   */
  private rootEventToMessage(
    event: NostrEvent,
    conversationId: string,
  ): Message {
    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo: undefined,
      protocol: "nip-22",
      metadata: { encrypted: false },
      event,
    };
  }

  /**
   * Convert event to Message
   */
  private eventToMessage(
    event: NostrEvent,
    conversationId: string,
    _meta: Conversation["metadata"],
  ): Message | null {
    // Zap receipts
    if (event.kind === 9735) {
      return this.zapToMessage(event, conversationId);
    }

    // Generic reposts
    if (event.kind === 16) {
      return this.repostToMessage(event, conversationId);
    }

    // Reactions — handled by MessageReactions component
    if (event.kind === 7) {
      return null;
    }

    // Kind 1111 comments
    if (event.kind === 1111) {
      const replyPointer = getCommentReplyPointer(event);

      // Convert CommentPointer to EventPointer for Message.replyTo
      let replyTo: EventPointer | undefined;
      if (replyPointer && isCommentEventPointer(replyPointer)) {
        replyTo = {
          id: replyPointer.id,
          relays: replyPointer.relay ? [replyPointer.relay] : undefined,
        };
      }

      return {
        id: event.id,
        conversationId,
        author: event.pubkey,
        content: event.content,
        timestamp: event.created_at,
        type: "user",
        replyTo,
        protocol: "nip-22",
        metadata: { encrypted: false },
        event,
      };
    }

    return null;
  }

  /**
   * Convert zap receipt to Message
   */
  private zapToMessage(
    zapReceipt: NostrEvent,
    conversationId: string,
  ): Message {
    const amount = getZapAmount(zapReceipt);
    const sender = getZapSender(zapReceipt);
    const recipient = getZapRecipient(zapReceipt);
    const amountInSats = amount ? Math.floor(amount / 1000) : 0;

    const eTag = zapReceipt.tags.find((t) => t[0] === "e");
    const replyTo = eTag
      ? (getEventPointerFromETag(eTag) ?? undefined)
      : undefined;

    const zapRequestTag = zapReceipt.tags.find((t) => t[0] === "description");
    let comment = "";
    if (zapRequestTag?.[1]) {
      try {
        const zapRequest = JSON.parse(zapRequestTag[1]) as NostrEvent;
        comment = zapRequest.content || "";
      } catch {
        // Invalid JSON
      }
    }

    return {
      id: zapReceipt.id,
      conversationId,
      author: sender || zapReceipt.pubkey,
      content: comment,
      timestamp: zapReceipt.created_at,
      type: "zap",
      replyTo,
      protocol: "nip-22",
      metadata: { zapAmount: amountInSats, zapRecipient: recipient },
      event: zapReceipt,
    };
  }

  /**
   * Convert repost to system Message
   */
  private repostToMessage(
    repostEvent: NostrEvent,
    conversationId: string,
  ): Message {
    const eTag = repostEvent.tags.find((t) => t[0] === "e");
    const replyTo = eTag
      ? (getEventPointerFromETag(eTag) ?? undefined)
      : undefined;

    return {
      id: repostEvent.id,
      conversationId,
      author: repostEvent.pubkey,
      content: "reposted",
      timestamp: repostEvent.created_at,
      type: "system",
      replyTo,
      protocol: "nip-22",
      metadata: {},
      event: repostEvent,
    };
  }

  /**
   * Fetch an event by ID from relays
   */
  private async fetchEvent(
    eventId: string,
    relayHints: string[] = [],
  ): Promise<NostrEvent | null> {
    // Check EventStore first
    const cached = await firstValueFrom(eventStore.event(eventId), {
      defaultValue: undefined,
    });
    if (cached) return cached;

    // Fetch from relays
    const relays =
      relayHints.length > 0 ? relayHints : await this.getDefaultRelays();

    try {
      const events = await firstValueFrom(
        pool
          .request(relays, [{ ids: [eventId], limit: 1 }], { eventStore })
          .pipe(
            rxTimeout(10_000),
            toArray(),
            catchError(() => of([])),
          ),
      );
      return events[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Get default relays when no hints provided
   */
  private async getDefaultRelays(): Promise<string[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey) {
      const relayList = await firstValueFrom(
        eventStore.replaceable(10002, activePubkey, ""),
        { defaultValue: undefined },
      );
      if (relayList) {
        const outbox = getOutboxes(relayList).slice(0, 5);
        if (outbox.length > 0) return outbox;
      }
    }
    return AGGREGATOR_RELAYS;
  }
}
