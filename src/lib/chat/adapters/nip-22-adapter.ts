import { Observable, firstValueFrom, combineLatest, of } from "rxjs";
import { map, first, toArray } from "rxjs/operators";
import type { Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
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
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { normalizeURL, getTagValue } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import {
  getZapAmount,
  getZapSender,
  getZapRecipient,
  getArticleTitle,
} from "applesauce-common/helpers";

/**
 * NIP-22 Adapter - Comments on Non-Kind-1 Events
 *
 * Features:
 * - Comment threads on articles, images, badges, and any non-kind-1 content
 * - Proper NIP-22 tag structure (uppercase for root, lowercase for parent)
 * - Root resolution: if given a kind 1111 comment, traces back to original content
 * - Supports addressable events (naddr) and regular events (nevent)
 *
 * Comment format:
 * - Root tags: E (event), A (address), I (external), K (kind), P (author)
 * - Parent tags: e, a, i, k, p (when replying to another comment)
 */
export class Nip22Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-22" as const;
  readonly type = "group" as const; // Comment threads are multi-participant

  /**
   * Parse identifier - accepts nevent (non-kind-1) or naddr format
   * Examples:
   *   - nevent1... (with kind != 1)
   *   - naddr1... (addressable events like articles)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try nevent format
    if (input.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nevent") {
          const { id, relays, author, kind } = decoded.data;

          // Only handle non-kind-1 events (kind 1 is handled by NIP-10)
          // If kind is unspecified, we'll check after fetching
          if (kind === 1) {
            return null;
          }

          return {
            type: "comment",
            value: { id, relays, author, kind },
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

          // Skip certain kinds handled by other adapters
          // 39000 = NIP-29 group metadata
          // 30311 = NIP-53 live activity
          // 10009 = Group list
          if (kind === 39000 || kind === 30311 || kind === 10009) {
            return null;
          }

          return {
            type: "comment",
            value: { kind, pubkey, identifier },
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

    // Determine if this is an event pointer or address pointer
    if ("id" in identifier.value) {
      // Event pointer
      return this.resolveFromEventPointer(identifier.value, relayHints);
    } else {
      // Address pointer
      return this.resolveFromAddressPointer(identifier.value, relayHints);
    }
  }

  /**
   * Resolve conversation from an event pointer (nevent)
   */
  private async resolveFromEventPointer(
    pointer: { id: string; relays?: string[]; author?: string; kind?: number },
    relayHints: string[],
  ): Promise<Conversation> {
    // 1. Fetch the provided event
    const providedEvent = await this.fetchEvent(
      pointer.id,
      pointer.relays || relayHints,
    );
    if (!providedEvent) {
      throw new Error("Event not found");
    }

    // 2. If this is a kind 1111 comment, resolve to the actual root
    if (providedEvent.kind === 1111) {
      return this.resolveFromComment(providedEvent, relayHints);
    }

    // 3. If this is kind 1, reject (NIP-10 should handle it)
    if (providedEvent.kind === 1) {
      throw new Error("Kind 1 notes should use NIP-10 thread chat");
    }

    // 4. This event IS the root - build conversation around it
    const conversationRelays = await this.getCommentRelays(
      providedEvent,
      relayHints,
    );
    const title = this.extractTitle(providedEvent);
    const participants = this.extractParticipants(providedEvent);

    return {
      id: `nip-22:${providedEvent.id}`,
      type: "group",
      protocol: "nip-22",
      title,
      participants,
      metadata: {
        rootEventId: providedEvent.id,
        providedEventId: providedEvent.id,
        rootKind: providedEvent.kind,
        description: providedEvent.content.slice(0, 200),
        relays: conversationRelays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Resolve conversation from an address pointer (naddr)
   */
  private async resolveFromAddressPointer(
    pointer: { kind: number; pubkey: string; identifier: string },
    relayHints: string[],
  ): Promise<Conversation> {
    // Fetch the replaceable event
    const rootEvent = await this.fetchReplaceableEvent(
      pointer.kind,
      pointer.pubkey,
      pointer.identifier,
      relayHints,
    );

    const coordinate = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;

    if (!rootEvent) {
      // Even without the event, we can create a conversation based on the address
      return {
        id: `nip-22:${coordinate}`,
        type: "group",
        protocol: "nip-22",
        title: `Comments on ${pointer.identifier || "content"}`,
        participants: [{ pubkey: pointer.pubkey, role: "op" }],
        metadata: {
          rootAddress: pointer,
          rootKind: pointer.kind,
          relays: relayHints.length > 0 ? relayHints : AGGREGATOR_RELAYS,
        },
        unreadCount: 0,
      };
    }

    const conversationRelays = await this.getCommentRelays(
      rootEvent,
      relayHints,
    );
    const title = this.extractTitle(rootEvent);
    const participants = this.extractParticipants(rootEvent);

    return {
      id: `nip-22:${coordinate}`,
      type: "group",
      protocol: "nip-22",
      title,
      participants,
      metadata: {
        rootEventId: rootEvent.id,
        rootAddress: pointer,
        rootKind: pointer.kind,
        description: rootEvent.content.slice(0, 200),
        relays: conversationRelays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Resolve conversation from a kind 1111 comment (trace back to root)
   */
  private async resolveFromComment(
    comment: NostrEvent,
    relayHints: string[],
  ): Promise<Conversation> {
    // Find root reference using uppercase tags
    const eTag = comment.tags.find((t) => t[0] === "E");
    const aTag = comment.tags.find((t) => t[0] === "A");
    const iTag = comment.tags.find((t) => t[0] === "I");
    const kTag = comment.tags.find((t) => t[0] === "K");

    const rootKind = kTag ? parseInt(kTag[1], 10) : undefined;

    // Try E tag (event root)
    if (eTag && eTag[1]) {
      const eventId = eTag[1];
      const relay = eTag[2];
      const rootPubkey = eTag[4];

      const rootEvent = await this.fetchEvent(
        eventId,
        relay ? [relay, ...relayHints] : relayHints,
      );

      if (rootEvent) {
        const conversationRelays = await this.getCommentRelays(
          rootEvent,
          relayHints,
        );
        const title = this.extractTitle(rootEvent);
        const participants = this.extractParticipants(rootEvent, comment);

        return {
          id: `nip-22:${eventId}`,
          type: "group",
          protocol: "nip-22",
          title,
          participants,
          metadata: {
            rootEventId: eventId,
            providedEventId: comment.id,
            rootKind: rootEvent.kind,
            description: rootEvent.content.slice(0, 200),
            relays: conversationRelays,
          },
          unreadCount: 0,
        };
      }

      // Root not found but we have the ID - create minimal conversation
      return {
        id: `nip-22:${eventId}`,
        type: "group",
        protocol: "nip-22",
        title: `Comments on event`,
        participants: rootPubkey
          ? [{ pubkey: rootPubkey, role: "op" }]
          : [{ pubkey: comment.pubkey, role: "member" }],
        metadata: {
          rootEventId: eventId,
          providedEventId: comment.id,
          rootKind,
          relays: relayHints.length > 0 ? relayHints : AGGREGATOR_RELAYS,
        },
        unreadCount: 0,
      };
    }

    // Try A tag (addressable root)
    if (aTag && aTag[1]) {
      const coordinate = aTag[1];
      const parts = coordinate.split(":");
      if (parts.length >= 3) {
        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const identifier = parts.slice(2).join(":");
        const relay = aTag[2];

        const rootEvent = await this.fetchReplaceableEvent(
          kind,
          pubkey,
          identifier,
          relay ? [relay, ...relayHints] : relayHints,
        );

        const rootAddress = { kind, pubkey, identifier };

        if (rootEvent) {
          const conversationRelays = await this.getCommentRelays(
            rootEvent,
            relayHints,
          );
          const title = this.extractTitle(rootEvent);
          const participants = this.extractParticipants(rootEvent, comment);

          return {
            id: `nip-22:${coordinate}`,
            type: "group",
            protocol: "nip-22",
            title,
            participants,
            metadata: {
              rootEventId: rootEvent.id,
              rootAddress,
              providedEventId: comment.id,
              rootKind: kind,
              description: rootEvent.content.slice(0, 200),
              relays: conversationRelays,
            },
            unreadCount: 0,
          };
        }

        // Root not found but we have the address
        return {
          id: `nip-22:${coordinate}`,
          type: "group",
          protocol: "nip-22",
          title: `Comments on ${identifier || "content"}`,
          participants: [{ pubkey, role: "op" }],
          metadata: {
            rootAddress,
            providedEventId: comment.id,
            rootKind: kind,
            relays: relayHints.length > 0 ? relayHints : AGGREGATOR_RELAYS,
          },
          unreadCount: 0,
        };
      }
    }

    // Try I tag (external identifier like URL)
    if (iTag && iTag[1]) {
      const externalId = iTag[1];

      return {
        id: `nip-22:external:${externalId}`,
        type: "group",
        protocol: "nip-22",
        title: `Comments on ${externalId}`,
        participants: [{ pubkey: comment.pubkey, role: "member" }],
        metadata: {
          rootExternal: externalId,
          providedEventId: comment.id,
          rootKind: 0, // External content has no kind
          relays: relayHints.length > 0 ? relayHints : AGGREGATOR_RELAYS,
        },
        unreadCount: 0,
      };
    }

    throw new Error("Could not resolve root from comment - no E, A, or I tag");
  }

  /**
   * Load messages (comments) for the conversation
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const rootEventId = conversation.metadata?.rootEventId;
    const rootAddress = conversation.metadata?.rootAddress;
    const rootExternal = conversation.metadata?.rootExternal;
    const relays = conversation.metadata?.relays || [];

    // Build filter based on root type
    const filters: Filter[] = [];

    if (rootEventId) {
      // Comments referencing this event
      filters.push({
        kinds: [1111],
        "#E": [rootEventId],
        limit: options?.limit || 100,
      });
      // Reactions on comments
      filters.push({
        kinds: [7],
        "#e": [rootEventId],
        limit: 200,
      });
      // Zaps on comments
      filters.push({
        kinds: [9735],
        "#e": [rootEventId],
        limit: 100,
      });
    }

    if (rootAddress) {
      const coordinate = `${rootAddress.kind}:${rootAddress.pubkey}:${rootAddress.identifier}`;
      filters.push({
        kinds: [1111],
        "#A": [coordinate],
        limit: options?.limit || 100,
      });
    }

    if (rootExternal) {
      filters.push({
        kinds: [1111],
        "#I": [rootExternal],
        limit: options?.limit || 100,
      });
    }

    if (filters.length === 0) {
      return of([]);
    }

    if (options?.before) {
      filters[0].until = options.before;
    }
    if (options?.after) {
      filters[0].since = options.after;
    }

    // Clean up any existing subscription
    const conversationId = conversation.id;
    this.cleanup(conversationId);

    // Start persistent subscription
    const subscription = pool
      .subscription(relays, filters, { eventStore })
      .subscribe({
        next: (_response) => {
          // EOSE or event - both handled by EventStore
        },
      });

    // Store subscription for cleanup
    this.subscriptions.set(conversationId, subscription);

    // Build timeline observable based on root type
    const commentFilters: Filter[] = [];

    if (rootEventId) {
      commentFilters.push({ kinds: [1111, 7, 9735], "#E": [rootEventId] });
      commentFilters.push({ kinds: [7, 9735], "#e": [rootEventId] });
    }
    if (rootAddress) {
      const coordinate = `${rootAddress.kind}:${rootAddress.pubkey}:${rootAddress.identifier}`;
      commentFilters.push({ kinds: [1111, 7, 9735], "#A": [coordinate] });
    }
    if (rootExternal) {
      commentFilters.push({ kinds: [1111], "#I": [rootExternal] });
    }

    // Combine all comment sources
    const comments$ =
      commentFilters.length > 0
        ? eventStore.timeline(commentFilters[0])
        : of([]);

    // Optionally fetch root event for display
    const rootEvent$ = rootEventId
      ? eventStore.event(rootEventId)
      : of(undefined);

    return combineLatest([rootEvent$, comments$]).pipe(
      map(([rootEvent, commentEvents]) => {
        const messages: Message[] = [];

        // Add root event as first message (if it's a regular event, not addressable)
        if (rootEvent && rootEvent.kind !== 1111) {
          const rootMessage = this.rootEventToMessage(
            rootEvent,
            conversationId,
          );
          if (rootMessage) {
            messages.push(rootMessage);
          }
        }

        // Convert comments to messages
        const commentMessages = commentEvents
          .map((event) =>
            this.eventToMessage(event, conversationId, rootEventId),
          )
          .filter((msg): msg is Message => msg !== null);

        messages.push(...commentMessages);

        // Sort by timestamp ascending (chronological order)
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
    const relays = conversation.metadata?.relays || [];

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
      const coordinate = `${rootAddress.kind}:${rootAddress.pubkey}:${rootAddress.identifier}`;
      filters.push({
        kinds: [1111],
        "#A": [coordinate],
        until: before,
        limit: 50,
      });
    }

    if (filters.length === 0) {
      return [];
    }

    const events = await firstValueFrom(
      pool.request(relays, filters, { eventStore }).pipe(toArray()),
    );

    const conversationId = conversation.id;

    const messages = events
      .map((event) => this.eventToMessage(event, conversationId, rootEventId))
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

    const rootEventId = conversation.metadata?.rootEventId;
    const rootAddress = conversation.metadata?.rootAddress;
    const rootExternal = conversation.metadata?.rootExternal;
    const rootKind = conversation.metadata?.rootKind;
    const relays = conversation.metadata?.relays || [];

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    // Build NIP-22 tags
    const tags: string[][] = [];

    // Add root reference (uppercase tags)
    if (rootEventId) {
      // Fetch root to get author
      const rootEvent = await firstValueFrom(eventStore.event(rootEventId), {
        defaultValue: undefined,
      });
      const rootPubkey = rootEvent?.pubkey;
      const rootEventKind = rootEvent?.kind || rootKind;

      tags.push([
        "E",
        rootEventId,
        relays[0] || "",
        rootEventKind?.toString() || "",
        rootPubkey || "",
      ]);
      tags.push(["K", (rootEventKind || 0).toString()]);
      if (rootPubkey) {
        tags.push(["P", rootPubkey]);
      }
    } else if (rootAddress) {
      const coordinate = `${rootAddress.kind}:${rootAddress.pubkey}:${rootAddress.identifier}`;
      tags.push(["A", coordinate, relays[0] || ""]);
      tags.push(["K", rootAddress.kind.toString()]);
      tags.push(["P", rootAddress.pubkey]);
    } else if (rootExternal) {
      tags.push(["I", rootExternal]);
      tags.push(["K", "0"]); // External content has no kind
    }

    // Handle reply to another comment
    if (options?.replyTo && options.replyTo !== rootEventId) {
      const parentEvent = await firstValueFrom(
        eventStore.event(options.replyTo),
        { defaultValue: undefined },
      );

      if (parentEvent) {
        // Add parent reference (lowercase tags)
        tags.push(["e", options.replyTo, relays[0] || "", parentEvent.pubkey]);
        tags.push(["k", parentEvent.kind.toString()]);
        tags.push(["p", parentEvent.pubkey]);
      }
    }

    // Add NIP-30 emoji tags
    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    // Add NIP-92 imeta tags for blob attachments
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        tags.push(["imeta", ...imetaParts]);
      }
    }

    // Create and sign kind 1111 event
    const draft = await factory.build({ kind: 1111, content, tags });
    const event = await factory.sign(draft);

    // Publish to conversation relays
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

    const tags: string[][] = [
      ["e", messageId],
      ["k", messageEvent.kind.toString()],
      ["p", messageEvent.pubkey],
    ];

    if (customEmoji) {
      tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
    }

    const draft = await factory.build({ kind: 7, content: emoji, tags });
    const event = await factory.sign(draft);

    await publishEventToRelays(event, relays);
  }

  /**
   * Get zap configuration for a message
   */
  getZapConfig(message: Message, conversation: Conversation): ZapConfig {
    const relays = conversation.metadata?.relays || [];

    const eventPointer = {
      id: message.id,
      author: message.author,
      relays,
    };

    return {
      supported: true,
      recipientPubkey: message.author,
      eventPointer,
      relays,
    };
  }

  /**
   * Load a replied-to message by ID
   */
  async loadReplyMessage(
    conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    const cachedEvent = await eventStore
      .event(eventId)
      .pipe(first())
      .toPromise();
    if (cachedEvent) {
      return cachedEvent;
    }

    const relays = conversation.metadata?.relays || [];
    if (relays.length === 0) {
      console.warn("[NIP-22] No relays for loading reply message");
      return null;
    }

    const filter: Filter = {
      ids: [eventId],
      limit: 1,
    };

    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    return events[0] || null;
  }

  /**
   * Get capabilities of NIP-22 protocol
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

  /**
   * Extract a readable title from root event
   */
  private extractTitle(rootEvent: NostrEvent): string {
    // Try article title first (kind 30023)
    if (rootEvent.kind === 30023) {
      const title = getArticleTitle(rootEvent);
      if (title) return title;
    }

    // Try title tag
    const titleTag = getTagValue(rootEvent, "title");
    if (titleTag) return titleTag;

    // Try name tag (for badges, etc.)
    const nameTag = getTagValue(rootEvent, "name");
    if (nameTag) return nameTag;

    // Fall back to content
    const content = rootEvent.content.trim();
    if (!content) return `Comments on kind ${rootEvent.kind}`;

    const firstLine = content.split("\n")[0];
    if (firstLine && firstLine.length <= 50) {
      return firstLine;
    }

    if (content.length <= 50) {
      return content;
    }

    return content.slice(0, 47) + "...";
  }

  /**
   * Extract participants from root and optional comment
   */
  private extractParticipants(
    rootEvent: NostrEvent,
    providedComment?: NostrEvent,
  ): Participant[] {
    const participants = new Map<string, Participant>();

    // Root author is OP
    participants.set(rootEvent.pubkey, {
      pubkey: rootEvent.pubkey,
      role: "op",
    });

    // Add p-tags from root
    for (const tag of rootEvent.tags) {
      if (tag[0] === "p" && tag[1] && tag[1] !== rootEvent.pubkey) {
        participants.set(tag[1], {
          pubkey: tag[1],
          role: "member",
        });
      }
    }

    // Add comment author if provided
    if (providedComment && providedComment.pubkey !== rootEvent.pubkey) {
      participants.set(providedComment.pubkey, {
        pubkey: providedComment.pubkey,
        role: "member",
      });
    }

    return Array.from(participants.values());
  }

  /**
   * Get relays for the comment thread
   */
  private async getCommentRelays(
    rootEvent: NostrEvent,
    providedRelays: string[],
  ): Promise<string[]> {
    const relays = new Set<string>();

    // 1. Provided relay hints
    providedRelays.forEach((r) => relays.add(normalizeURL(r)));

    // 2. Root author's outbox relays
    try {
      const rootOutbox = await this.getOutboxRelays(rootEvent.pubkey);
      rootOutbox.slice(0, 3).forEach((r) => relays.add(normalizeURL(r)));
    } catch (err) {
      console.warn("[NIP-22] Failed to get root author outbox:", err);
    }

    // 3. Active user's outbox
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey && activePubkey !== rootEvent.pubkey) {
      try {
        const userOutbox = await this.getOutboxRelays(activePubkey);
        userOutbox.slice(0, 2).forEach((r) => relays.add(normalizeURL(r)));
      } catch (err) {
        console.warn("[NIP-22] Failed to get user outbox:", err);
      }
    }

    // 4. Fallback to aggregator relays
    if (relays.size < 3) {
      AGGREGATOR_RELAYS.forEach((r) => relays.add(r));
    }

    return Array.from(relays).slice(0, 10);
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

    return relayList.tags
      .filter((t) => {
        if (t[0] !== "r") return false;
        const marker = t[2];
        return !marker || marker === "write";
      })
      .map((t) => normalizeURL(t[1]))
      .slice(0, 5);
  }

  /**
   * Fetch an event by ID
   */
  private async fetchEvent(
    eventId: string,
    relayHints: string[] = [],
  ): Promise<NostrEvent | null> {
    const cached = await firstValueFrom(eventStore.event(eventId), {
      defaultValue: undefined,
    });
    if (cached) return cached;

    const relays =
      relayHints.length > 0 ? relayHints : await this.getDefaultRelays();

    const filter: Filter = {
      ids: [eventId],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription(relays, [filter], { eventStore });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 5000);

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
        error: (err) => {
          clearTimeout(timeout);
          console.error(`[NIP-22] Fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Fetch a replaceable event by address
   */
  private async fetchReplaceableEvent(
    kind: number,
    pubkey: string,
    identifier: string,
    relayHints: string[] = [],
  ): Promise<NostrEvent | null> {
    const cached = await firstValueFrom(
      eventStore.replaceable(kind, pubkey, identifier),
      { defaultValue: undefined },
    );
    if (cached) return cached;

    const relays =
      relayHints.length > 0 ? relayHints : await this.getDefaultRelays();

    const filter: Filter = {
      kinds: [kind],
      authors: [pubkey],
      "#d": [identifier],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription(relays, [filter], { eventStore });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 5000);

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
        error: (err) => {
          clearTimeout(timeout);
          console.error(`[NIP-22] Fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Get default relays
   */
  private async getDefaultRelays(): Promise<string[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey) {
      const outbox = await this.getOutboxRelays(activePubkey);
      if (outbox.length > 0) return outbox.slice(0, 5);
    }

    return AGGREGATOR_RELAYS;
  }

  /**
   * Convert root event to Message object
   */
  private rootEventToMessage(
    event: NostrEvent,
    conversationId: string,
  ): Message | null {
    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo: undefined,
      protocol: "nip-22",
      metadata: {
        encrypted: false,
      },
      event,
    };
  }

  /**
   * Convert event to Message object
   */
  private eventToMessage(
    event: NostrEvent,
    conversationId: string,
    rootEventId?: string,
  ): Message | null {
    // Handle zap receipts
    if (event.kind === 9735) {
      return this.zapToMessage(event, conversationId);
    }

    // Handle reactions - skip for now
    if (event.kind === 7) {
      return null;
    }

    // Handle comments (kind 1111)
    if (event.kind === 1111) {
      // Find parent reference (lowercase e tag)
      const parentTag = event.tags.find((t) => t[0] === "e");
      const replyTo = parentTag?.[1] || rootEventId;

      return {
        id: event.id,
        conversationId,
        author: event.pubkey,
        content: event.content,
        timestamp: event.created_at,
        type: "user",
        replyTo,
        protocol: "nip-22",
        metadata: {
          encrypted: false,
        },
        event,
      };
    }

    // Other event types (the root itself)
    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo: undefined,
      protocol: "nip-22",
      metadata: {
        encrypted: false,
      },
      event,
    };
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

    const eTag = zapReceipt.tags.find((t) => t[0] === "e");
    const replyTo = eTag?.[1];

    const zapRequestTag = zapReceipt.tags.find((t) => t[0] === "description");
    let comment = "";
    if (zapRequestTag && zapRequestTag[1]) {
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
        zapAmount: amount,
        zapRecipient: recipient,
      },
      event: zapReceipt,
    };
  }
}
