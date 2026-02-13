import { Observable, firstValueFrom, combineLatest } from "rxjs";
import { map, first, toArray } from "rxjs/operators";
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
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { mergeRelaySets, getTagValue } from "applesauce-core/helpers";
import { getOutboxes } from "applesauce-core/helpers/mailboxes";
import { EventFactory } from "applesauce-core/event-factory";
import {
  CommentBlueprint,
  ReactionBlueprint,
} from "applesauce-common/blueprints";
import {
  getCommentReplyPointer,
  type CommentPointer,
  type CommentEventPointer,
  type CommentAddressPointer,
} from "applesauce-common/helpers/comment";
import {
  getZapAmount,
  getZapSender,
  getZapRecipient,
} from "applesauce-common/helpers";
import { getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { getKindName } from "@/constants/kinds";

/**
 * NIP-22 Adapter - Comments on Any Event
 *
 * Features:
 * - Comment on any Nostr event (articles, pictures, videos, repos, etc.)
 * - Comment on external resources (URLs, ISBNs, DOIs, podcasts)
 * - Threaded replies between comments
 * - Uses applesauce CommentBlueprint for proper NIP-22 tag structure
 * - Smart relay selection (merges multiple sources)
 *
 * Acts as the wildcard chat adapter for events not handled by
 * NIP-10 (kind 1 threads) or NIP-53 (kind 30311 live activities).
 *
 * Identifier formats:
 *   - nevent1... (any kind except 1)
 *   - naddr1... (any addressable kind except 30311, 39000, 10009)
 */
export class Nip22Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-22" as const;
  readonly type = "comments" as const;

  // Kinds claimed by other adapters
  private static readonly EXCLUDED_NEVENT_KINDS = new Set([1]);
  private static readonly EXCLUDED_NADDR_KINDS = new Set([
    30311, 39000, 39001, 39002, 10009,
  ]);

  /**
   * Parse identifier - accepts nevent/naddr for events not claimed by other adapters
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try nevent format
    if (input.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nevent") {
          const { id, relays, author, kind } = decoded.data;

          // If kind is specified and claimed by another adapter, skip
          if (
            kind !== undefined &&
            Nip22Adapter.EXCLUDED_NEVENT_KINDS.has(kind)
          ) {
            return null;
          }

          return {
            type: "comment",
            value: {
              id,
              kind: kind ?? 0, // 0 = unknown, will be resolved
              pubkey: author,
              relay: relays?.[0],
            },
            relays: relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try naddr format (addressable events)
    if (input.startsWith("naddr1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "naddr") {
          const { kind, pubkey, identifier, relays } = decoded.data;

          // If kind is claimed by another adapter, skip
          if (Nip22Adapter.EXCLUDED_NADDR_KINDS.has(kind)) {
            return null;
          }

          return {
            type: "comment-address",
            value: { kind, pubkey, identifier },
            relays: relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try note format (no kind info — assume non-kind-1 since NIP-10 runs first)
    if (input.startsWith("note1")) {
      // NIP-10 adapter handles note1 first in the parser chain.
      // If we get here, NIP-10 already rejected it (shouldn't happen for note1).
      // Don't claim note1 — it's ambiguous without kind info.
      return null;
    }

    return null;
  }

  /**
   * Resolve conversation from comment identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (identifier.type === "comment") {
      return this.resolveEventConversation(identifier);
    }
    if (identifier.type === "comment-address") {
      return this.resolveAddressConversation(identifier);
    }
    if (identifier.type === "comment-external") {
      return this.resolveExternalConversation(identifier);
    }

    throw new Error(
      `NIP-22 adapter cannot handle identifier type: ${identifier.type}`,
    );
  }

  /**
   * Resolve conversation for a regular event (nevent)
   */
  private async resolveEventConversation(
    identifier: ProtocolIdentifier & { type: "comment" },
  ): Promise<Conversation> {
    const { id, pubkey } = identifier.value;
    const relayHints = identifier.relays || [];

    // Fetch the root event
    const rootEvent = await this.fetchEvent(id, relayHints);
    if (!rootEvent) {
      throw new Error("Event not found");
    }

    // Determine relays
    const conversationRelays = await this.getCommentRelays(
      rootEvent,
      relayHints,
    );

    // Build conversation ID and title
    const resolvedKind = rootEvent.kind;
    const kindName = getKindName(resolvedKind);
    const title = this.extractTitle(rootEvent, kindName);

    return {
      id: `nip-22:${rootEvent.id}`,
      type: "comments",
      protocol: "nip-22",
      title,
      participants: [
        { pubkey: rootEvent.pubkey, role: "op" },
        ...(pubkey && pubkey !== rootEvent.pubkey
          ? [{ pubkey, role: "member" as const }]
          : []),
      ],
      metadata: {
        rootEventId: rootEvent.id,
        rootEventKind: resolvedKind,
        description: rootEvent.content.slice(0, 200),
        relays: conversationRelays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Resolve conversation for an addressable event (naddr)
   */
  private async resolveAddressConversation(
    identifier: ProtocolIdentifier & { type: "comment-address" },
  ): Promise<Conversation> {
    const { kind, pubkey, identifier: dTag } = identifier.value;
    const relayHints = identifier.relays || [];

    // Fetch the addressable event
    const rootEvent = await this.fetchAddressableEvent(
      kind,
      pubkey,
      dTag,
      relayHints,
    );

    // Build the root address string
    const rootAddress = `${kind}:${pubkey}:${dTag}`;

    // Determine relays
    const conversationRelays = rootEvent
      ? await this.getCommentRelays(rootEvent, relayHints)
      : await this.getDefaultRelays(relayHints);

    // Build title
    const kindName = getKindName(kind);
    const title = rootEvent
      ? this.extractTitle(rootEvent, kindName)
      : `${kindName} Comments`;

    return {
      id: `nip-22:${rootAddress}`,
      type: "comments",
      protocol: "nip-22",
      title,
      participants: [{ pubkey, role: "op" }],
      metadata: {
        rootEventId: rootEvent?.id,
        rootEventKind: kind,
        rootAddress,
        description: rootEvent?.content.slice(0, 200),
        relays: conversationRelays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Resolve conversation for an external resource (NIP-73)
   */
  private async resolveExternalConversation(
    identifier: ProtocolIdentifier & { type: "comment-external" },
  ): Promise<Conversation> {
    const { value: externalId, externalKind } = identifier;

    // For external identifiers, we use aggregator relays
    const relays = [...AGGREGATOR_RELAYS];

    // Build a human-readable title
    let title = externalId;
    if (externalKind === "web") {
      try {
        const url = new URL(externalId);
        title = url.hostname + url.pathname;
      } catch {
        // Keep raw value
      }
    }

    return {
      id: `nip-22:ext:${externalKind}:${externalId}`,
      type: "comments",
      protocol: "nip-22",
      title: `Comments on ${title}`,
      participants: [],
      metadata: {
        externalId,
        externalKind,
        relays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages (comments) for a conversation
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const rootEventId = conversation.metadata?.rootEventId;
    const rootAddress = conversation.metadata?.rootAddress;
    const externalId = conversation.metadata?.externalId;
    const relays = conversation.metadata?.relays || [];
    const conversationId = conversation.id;

    // Build comment filters based on root type
    const commentFilters: Filter[] = [];

    // Comments by event ID (E tag)
    if (rootEventId) {
      commentFilters.push({
        kinds: [1111],
        "#E": [rootEventId],
        limit: options?.limit || 100,
        ...(options?.before ? { until: options.before } : {}),
        ...(options?.after ? { since: options.after } : {}),
      });
    }

    // Comments by address (A tag) — for addressable events
    if (rootAddress) {
      commentFilters.push({
        kinds: [1111],
        "#A": [rootAddress],
        limit: options?.limit || 100,
        ...(options?.before ? { until: options.before } : {}),
        ...(options?.after ? { since: options.after } : {}),
      });
    }

    // Comments by external identifier (I tag)
    if (externalId) {
      commentFilters.push({
        kinds: [1111],
        "#I": [externalId],
        limit: options?.limit || 100,
        ...(options?.before ? { until: options.before } : {}),
        ...(options?.after ? { since: options.after } : {}),
      });
    }

    if (commentFilters.length === 0) {
      throw new Error("No root identifier available for loading comments");
    }

    // Also fetch reactions and zaps on the root event
    const auxFilters: Filter[] = [];
    if (rootEventId) {
      auxFilters.push(
        { kinds: [7], "#e": [rootEventId], limit: 200 },
        { kinds: [9735], "#e": [rootEventId], limit: 100 },
      );
    }

    const allFilters = [...commentFilters, ...auxFilters];

    // Clean up existing subscription
    this.cleanup(conversationId);

    // Start persistent subscription
    const subscription = pool
      .subscription(relays, allFilters, { eventStore })
      .subscribe({
        next: () => {
          // Events handled by EventStore
        },
      });

    this.subscriptions.set(conversationId, subscription);

    // Build timeline observables
    const commentTimelineFilters: Filter[] = [];
    if (rootEventId) {
      commentTimelineFilters.push({ kinds: [1111], "#E": [rootEventId] });
    }
    if (rootAddress) {
      commentTimelineFilters.push({ kinds: [1111], "#A": [rootAddress] });
    }
    if (externalId) {
      commentTimelineFilters.push({ kinds: [1111], "#I": [externalId] });
    }

    // Observable for root event (if we have an ID)
    const rootEvent$ = rootEventId
      ? eventStore.event(rootEventId)
      : new Observable<NostrEvent | undefined>((sub) => {
          sub.next(undefined);
        });

    // Observable for comments — use individual timelines and merge
    const comments$ =
      commentTimelineFilters.length === 1
        ? eventStore.timeline(commentTimelineFilters[0])
        : combineLatest(
            commentTimelineFilters.map((f) => eventStore.timeline(f)),
          ).pipe(
            map((arrays) => {
              // Deduplicate by event ID
              const seen = new Set<string>();
              const merged: NostrEvent[] = [];
              for (const arr of arrays) {
                for (const ev of arr) {
                  if (!seen.has(ev.id)) {
                    seen.add(ev.id);
                    merged.push(ev);
                  }
                }
              }
              return merged;
            }),
          );

    // Also load zaps and reactions for the timeline
    const auxTimeline$ = rootEventId
      ? eventStore.timeline({
          kinds: [7, 9735],
          "#e": [rootEventId],
        })
      : new Observable<NostrEvent[]>((sub) => {
          sub.next([]);
        });

    return combineLatest([rootEvent$, comments$, auxTimeline$]).pipe(
      map(([rootEvent, comments, auxEvents]) => {
        const messages: Message[] = [];

        // Add root event as first message
        if (rootEvent) {
          messages.push(this.rootEventToMessage(rootEvent, conversationId));
        }

        // Convert comments to messages
        for (const event of comments) {
          const msg = this.commentToMessage(event, conversationId);
          if (msg) messages.push(msg);
        }

        // Convert zaps to messages
        for (const event of auxEvents) {
          if (event.kind === 9735) {
            const msg = this.zapToMessage(event, conversationId);
            if (msg) messages.push(msg);
          }
          // Reactions (kind 7) handled via MessageReactions component
        }

        // Sort chronologically
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
    );
  }

  /**
   * Load more historical comments (pagination)
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const rootEventId = conversation.metadata?.rootEventId;
    const rootAddress = conversation.metadata?.rootAddress;
    const externalId = conversation.metadata?.externalId;
    const relays = conversation.metadata?.relays || [];
    const conversationId = conversation.id;

    const filters: Filter[] = [];

    if (rootEventId) {
      filters.push({
        kinds: [1111],
        "#E": [rootEventId],
        until: before,
        limit: 50,
      });
    }
    if (rootAddress) {
      filters.push({
        kinds: [1111],
        "#A": [rootAddress],
        until: before,
        limit: 50,
      });
    }
    if (externalId) {
      filters.push({
        kinds: [1111],
        "#I": [externalId],
        until: before,
        limit: 50,
      });
    }

    if (filters.length === 0) return [];

    const events = await firstValueFrom(
      pool.request(relays, filters, { eventStore }).pipe(toArray()),
    );

    const messages = events
      .map((event) => this.commentToMessage(event, conversationId))
      .filter((msg): msg is Message => msg !== null);

    return messages.reverse();
  }

  /**
   * Send a comment using applesauce CommentBlueprint
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

    const relays = conversation.metadata?.relays || [];

    // Determine parent: either a reply target or the root
    let parent: NostrEvent | CommentPointer;

    if (options?.replyTo) {
      // Replying to a specific comment — pass the comment event to CommentBlueprint
      // so it auto-extracts root tags and creates proper reply tags
      const parentEvent = await firstValueFrom(
        eventStore.event(options.replyTo),
        { defaultValue: undefined },
      );
      if (!parentEvent) {
        throw new Error("Parent comment event not found in store");
      }
      parent = parentEvent;
    } else {
      // Top-level comment on root — build a CommentPointer
      parent = this.buildRootPointer(conversation);
    }

    // Create event with CommentBlueprint
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const draft = await factory.create(CommentBlueprint, parent, content, {
      emojis: options?.emojiTags?.map((e) => ({
        shortcode: e.shortcode,
        url: e.url,
      })),
    });

    // Add NIP-92 imeta tags for blob attachments
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        draft.tags.push(["imeta", ...imetaParts]);
      }
    }

    const event = await factory.sign(draft);
    await publishEventToRelays(event, relays);
  }

  /**
   * Send a reaction (kind 7) to a comment
   */
  async sendReaction(
    conversation: Conversation,
    messageId: string,
    emoji: string,
    customEmoji?: { shortcode: string; url: string },
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

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const emojiArg = customEmoji
      ? { shortcode: customEmoji.shortcode, url: customEmoji.url }
      : emoji;

    const draft = await factory.create(
      ReactionBlueprint,
      messageEvent,
      emojiArg,
    );

    const event = await factory.sign(draft);
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
    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

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
   * Build a CommentPointer for the root event/resource of a conversation
   */
  private buildRootPointer(conversation: Conversation): CommentPointer {
    const meta = conversation.metadata;

    // External identifier
    if (meta?.externalId && meta?.externalKind) {
      return {
        type: "external",
        kind: meta.externalKind,
        identifier: meta.externalId,
      } as CommentPointer;
    }

    // Addressable event (has rootAddress like "kind:pubkey:d-tag")
    if (meta?.rootAddress) {
      const parts = meta.rootAddress.split(":");
      const kind = parseInt(parts[0]);
      const pubkey = parts[1];
      const identifier = parts.slice(2).join(":");

      const pointer: CommentAddressPointer = {
        type: "address",
        kind,
        pubkey,
        identifier,
        id: meta.rootEventId,
      };
      return pointer;
    }

    // Regular event
    if (meta?.rootEventId) {
      const pointer: CommentEventPointer = {
        type: "event",
        id: meta.rootEventId,
        kind: meta.rootEventKind ?? 0,
        pubkey: conversation.participants[0]?.pubkey,
      };
      return pointer;
    }

    throw new Error("Cannot build root pointer: no root identifier");
  }

  /**
   * Extract a readable title from root event
   */
  private extractTitle(rootEvent: NostrEvent, kindName: string): string {
    // Try title tag (articles, wiki, etc.)
    const titleTag = getTagValue(rootEvent, "title");
    if (titleTag) return titleTag;

    // Try name tag (repos, products, etc.)
    const nameTag = getTagValue(rootEvent, "name");
    if (nameTag) return nameTag;

    // Try d-tag as fallback for addressable events
    if (isAddressableKind(rootEvent.kind)) {
      const dTag = getTagValue(rootEvent, "d");
      if (dTag) return `${kindName}: ${dTag}`;
    }

    // Fall back to content
    const content = rootEvent.content.trim();
    if (!content) return `${kindName} Comments`;

    const firstLine = content.split("\n")[0];
    if (firstLine && firstLine.length <= 50) return firstLine;
    if (content.length <= 50) return content;
    return content.slice(0, 47) + "...";
  }

  /**
   * Convert root event to a Message (displayed at top of chat)
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
   * Convert a kind 1111 comment event to a Message
   */
  private commentToMessage(
    event: NostrEvent,
    conversationId: string,
  ): Message | null {
    if (event.kind !== 1111) return null;

    // Parse reply pointer to determine what this comment replies to
    const replyPointer = getCommentReplyPointer(event);
    let replyTo: EventPointer | undefined;

    if (replyPointer) {
      if (replyPointer.type === "event") {
        replyTo = {
          id: replyPointer.id,
          relays: replyPointer.relay ? [replyPointer.relay] : undefined,
        };
      } else if (replyPointer.type === "address" && replyPointer.id) {
        replyTo = {
          id: replyPointer.id,
          relays: replyPointer.relay ? [replyPointer.relay] : undefined,
        };
      }
      // For external pointers, replyTo is left undefined
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

  /**
   * Convert zap receipt to Message
   */
  private zapToMessage(
    zapReceipt: NostrEvent,
    conversationId: string,
  ): Message | null {
    const amount = getZapAmount(zapReceipt);
    const sender = getZapSender(zapReceipt);
    const recipient = getZapRecipient(zapReceipt);
    const amountInSats = amount ? Math.floor(amount / 1000) : 0;

    const eTag = zapReceipt.tags.find((t) => t[0] === "e");
    const replyTo = eTag
      ? (getEventPointerFromETag(eTag) ?? undefined)
      : undefined;

    // Get zap request comment
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
      metadata: {
        zapAmount: amountInSats,
        zapRecipient: recipient,
      },
      event: zapReceipt,
    };
  }

  /**
   * Determine relays for comment loading/publishing
   */
  private async getCommentRelays(
    rootEvent: NostrEvent,
    providedRelays: string[],
  ): Promise<string[]> {
    const relaySets: string[][] = [];

    // 1. Provided relay hints
    relaySets.push(providedRelays);

    // 2. Root author's outbox relays
    try {
      const rootOutbox = await this.getOutboxRelays(rootEvent.pubkey);
      relaySets.push(rootOutbox.slice(0, 3));
    } catch {
      // Continue without
    }

    // 3. Active user's outbox (for publishing)
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey && activePubkey !== rootEvent.pubkey) {
      try {
        const userOutbox = await this.getOutboxRelays(activePubkey);
        relaySets.push(userOutbox.slice(0, 2));
      } catch {
        // Continue without
      }
    }

    let relays = mergeRelaySets(...relaySets);

    // Fallback to aggregator relays
    if (relays.length < 3) {
      relays = mergeRelaySets(relays, AGGREGATOR_RELAYS);
    }

    return relays.slice(0, 10);
  }

  /**
   * Get default relays when we don't have a root event
   */
  private async getDefaultRelays(providedRelays: string[]): Promise<string[]> {
    const relaySets: string[][] = [providedRelays];

    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey) {
      try {
        const userOutbox = await this.getOutboxRelays(activePubkey);
        relaySets.push(userOutbox.slice(0, 3));
      } catch {
        // Continue without
      }
    }

    let relays = mergeRelaySets(...relaySets);
    if (relays.length < 3) {
      relays = mergeRelaySets(relays, AGGREGATOR_RELAYS);
    }
    return relays.slice(0, 10);
  }

  /**
   * Get outbox relays for a pubkey (NIP-65)
   */
  private async getOutboxRelays(pubkey: string): Promise<string[]> {
    const relayList = await firstValueFrom(
      eventStore.replaceable(10002, pubkey, ""),
      { defaultValue: undefined },
    );

    if (!relayList) return [];
    return getOutboxes(relayList).slice(0, 5);
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
      relayHints.length > 0 ? relayHints : await this.getDefaultRelays([]);

    const filter: Filter = { ids: [eventId], limit: 1 };
    const events: NostrEvent[] = [];
    const obs = pool.subscription(relays, [filter], { eventStore });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5000);

      const sub = obs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            events.push(response);
          }
        },
        error: () => {
          clearTimeout(timeout);
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Fetch an addressable event by kind, pubkey, d-tag
   */
  private async fetchAddressableEvent(
    kind: number,
    pubkey: string,
    dTag: string,
    relayHints: string[] = [],
  ): Promise<NostrEvent | null> {
    // Check EventStore first
    const cached = await firstValueFrom(
      eventStore.replaceable(kind, pubkey, dTag),
      { defaultValue: undefined },
    );
    if (cached) return cached;

    // Fetch from relays
    const relays =
      relayHints.length > 0 ? relayHints : await this.getDefaultRelays([]);

    const filter: Filter = {
      kinds: [kind],
      authors: [pubkey],
      "#d": [dTag],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription(relays, [filter], { eventStore });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5000);

      const sub = obs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            events.push(response);
          }
        },
        error: () => {
          clearTimeout(timeout);
          resolve();
        },
      });
    });

    return events[0] || null;
  }
}
