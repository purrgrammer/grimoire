import { Observable, firstValueFrom, combineLatest, of } from "rxjs";
import { map, toArray } from "rxjs/operators";
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
import { getTagValue } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import { getArticleTitle } from "applesauce-common/helpers";
import {
  fetchEvent,
  fetchReplaceableEvent,
  getOutboxRelays,
  mergeRelays,
  zapReceiptToMessage,
  eventToMessage,
  getNip22ReplyTo,
  AGGREGATOR_RELAYS,
} from "../utils";

const LOG_PREFIX = "[NIP-22]";

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
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try nevent format
    if (input.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nevent") {
          const { id, relays, author, kind } = decoded.data;

          // Only handle non-kind-1 events (kind 1 is handled by NIP-10)
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

          // Skip kinds handled by other adapters
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

    if ("id" in identifier.value) {
      return this.resolveFromEventPointer(identifier.value, relayHints);
    } else {
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
    const providedEvent = await fetchEvent(pointer.id, {
      relayHints: pointer.relays || relayHints,
      logPrefix: LOG_PREFIX,
    });

    if (!providedEvent) {
      throw new Error("Event not found");
    }

    // If kind 1111 comment, resolve to actual root
    if (providedEvent.kind === 1111) {
      return this.resolveFromComment(providedEvent, relayHints);
    }

    // Kind 1 should use NIP-10
    if (providedEvent.kind === 1) {
      throw new Error("Kind 1 notes should use NIP-10 thread chat");
    }

    // This event IS the root
    const conversationRelays = await this.buildRelays(
      providedEvent.pubkey,
      relayHints,
    );

    return {
      id: `nip-22:${providedEvent.id}`,
      type: "group",
      protocol: "nip-22",
      title: this.extractTitle(providedEvent),
      participants: this.extractParticipants(providedEvent),
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
    const rootEvent = await fetchReplaceableEvent(
      pointer.kind,
      pointer.pubkey,
      {
        identifier: pointer.identifier,
        relayHints,
        logPrefix: LOG_PREFIX,
      },
    );

    const coordinate = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;

    if (!rootEvent) {
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

    const conversationRelays = await this.buildRelays(
      rootEvent.pubkey,
      relayHints,
    );

    return {
      id: `nip-22:${coordinate}`,
      type: "group",
      protocol: "nip-22",
      title: this.extractTitle(rootEvent),
      participants: this.extractParticipants(rootEvent),
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
    const eTag = comment.tags.find((t) => t[0] === "E");
    const aTag = comment.tags.find((t) => t[0] === "A");
    const iTag = comment.tags.find((t) => t[0] === "I");
    const kTag = comment.tags.find((t) => t[0] === "K");
    const rootKind = kTag ? parseInt(kTag[1], 10) : undefined;

    // Try E tag (event root)
    if (eTag?.[1]) {
      const eventId = eTag[1];
      const relay = eTag[2];
      const rootPubkey = eTag[4];

      const rootEvent = await fetchEvent(eventId, {
        relayHints: relay ? [relay, ...relayHints] : relayHints,
        logPrefix: LOG_PREFIX,
      });

      if (rootEvent) {
        const conversationRelays = await this.buildRelays(
          rootEvent.pubkey,
          relayHints,
        );

        return {
          id: `nip-22:${eventId}`,
          type: "group",
          protocol: "nip-22",
          title: this.extractTitle(rootEvent),
          participants: this.extractParticipants(rootEvent, comment),
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

      // Root not found - create minimal conversation
      return {
        id: `nip-22:${eventId}`,
        type: "group",
        protocol: "nip-22",
        title: "Comments on event",
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
    if (aTag?.[1]) {
      const coordinate = aTag[1];
      const parts = coordinate.split(":");
      if (parts.length >= 3) {
        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const identifier = parts.slice(2).join(":");
        const relay = aTag[2];

        const rootEvent = await fetchReplaceableEvent(kind, pubkey, {
          identifier,
          relayHints: relay ? [relay, ...relayHints] : relayHints,
          logPrefix: LOG_PREFIX,
        });

        const rootAddress = { kind, pubkey, identifier };

        if (rootEvent) {
          const conversationRelays = await this.buildRelays(
            rootEvent.pubkey,
            relayHints,
          );

          return {
            id: `nip-22:${coordinate}`,
            type: "group",
            protocol: "nip-22",
            title: this.extractTitle(rootEvent),
            participants: this.extractParticipants(rootEvent, comment),
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

    // Try I tag (external identifier)
    if (iTag?.[1]) {
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
          rootKind: 0,
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
    const conversationId = conversation.id;

    // Build filters based on root type
    const filters: Filter[] = [];

    if (rootEventId) {
      filters.push({
        kinds: [1111],
        "#E": [rootEventId],
        limit: options?.limit || 100,
      });
      filters.push({ kinds: [7, 9735], "#e": [rootEventId], limit: 200 });
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

    if (options?.before) filters[0].until = options.before;
    if (options?.after) filters[0].since = options.after;

    // Cleanup existing subscription
    this.cleanup(conversationId);

    // Start persistent subscription
    const subscription = pool
      .subscription(relays, filters, { eventStore })
      .subscribe();

    this.subscriptions.set(conversationId, subscription);

    // Build timeline observable
    const commentFilter: Filter = rootEventId
      ? { kinds: [1111, 7, 9735], "#E": [rootEventId] }
      : rootAddress
        ? {
            kinds: [1111, 7, 9735],
            "#A": [
              `${rootAddress.kind}:${rootAddress.pubkey}:${rootAddress.identifier}`,
            ],
          }
        : { kinds: [1111], "#I": [rootExternal!] };

    const comments$ = eventStore.timeline(commentFilter);
    const rootEvent$ = rootEventId
      ? eventStore.event(rootEventId)
      : of(undefined);

    return combineLatest([rootEvent$, comments$]).pipe(
      map(([rootEvent, commentEvents]) => {
        const messages: Message[] = [];

        // Add root event as first message (if available and not a comment)
        if (rootEvent && rootEvent.kind !== 1111) {
          messages.push(
            eventToMessage(rootEvent, {
              conversationId,
              protocol: "nip-22",
            }),
          );
        }

        // Convert comments to messages
        for (const event of commentEvents) {
          const msg = this.convertEventToMessage(
            event,
            conversationId,
            rootEventId,
          );
          if (msg) messages.push(msg);
        }

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
      const coordinate = `${rootAddress.kind}:${rootAddress.pubkey}:${rootAddress.identifier}`;
      filters.push({
        kinds: [1111],
        "#A": [coordinate],
        until: before,
        limit: 50,
      });
    }

    if (filters.length === 0) return [];

    const events = await firstValueFrom(
      pool.request(relays, filters, { eventStore }).pipe(toArray()),
    );

    return events
      .map((e) => this.convertEventToMessage(e, conversationId, rootEventId))
      .filter((msg): msg is Message => msg !== null)
      .reverse();
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

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [];

    // Add root reference (uppercase tags)
    if (rootEventId) {
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
      if (rootPubkey) tags.push(["P", rootPubkey]);
    } else if (rootAddress) {
      const coordinate = `${rootAddress.kind}:${rootAddress.pubkey}:${rootAddress.identifier}`;
      tags.push(["A", coordinate, relays[0] || ""]);
      tags.push(["K", rootAddress.kind.toString()]);
      tags.push(["P", rootAddress.pubkey]);
    } else if (rootExternal) {
      tags.push(["I", rootExternal]);
      tags.push(["K", "0"]);
    }

    // Handle reply to another comment
    if (options?.replyTo && options.replyTo !== rootEventId) {
      const parentEvent = await firstValueFrom(
        eventStore.event(options.replyTo),
        { defaultValue: undefined },
      );

      if (parentEvent) {
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

    // Add NIP-92 imeta tags
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        tags.push(["imeta", ...imetaParts]);
      }
    }

    const draft = await factory.build({ kind: 1111, content, tags });
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
   * Load a replied-to message by ID
   */
  async loadReplyMessage(
    conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    const relays = conversation.metadata?.relays || [];

    return fetchEvent(eventId, {
      relayHints: relays,
      logPrefix: LOG_PREFIX,
    });
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

  // --- Private helpers ---

  /**
   * Build relay list from pubkey outboxes and hints
   */
  private async buildRelays(
    rootPubkey: string,
    providedRelays: string[],
  ): Promise<string[]> {
    const rootOutbox = await getOutboxRelays(rootPubkey, { maxRelays: 3 });

    const activePubkey = accountManager.active$.value?.pubkey;
    const userOutbox =
      activePubkey && activePubkey !== rootPubkey
        ? await getOutboxRelays(activePubkey, { maxRelays: 2 })
        : [];

    return mergeRelays([providedRelays, rootOutbox, userOutbox], {
      maxRelays: 10,
      minRelays: 3,
    });
  }

  /**
   * Extract title from root event
   */
  private extractTitle(rootEvent: NostrEvent): string {
    // Try article title (kind 30023)
    if (rootEvent.kind === 30023) {
      const title = getArticleTitle(rootEvent);
      if (title) return title;
    }

    // Try title/name tags
    const titleTag = getTagValue(rootEvent, "title");
    if (titleTag) return titleTag;

    const nameTag = getTagValue(rootEvent, "name");
    if (nameTag) return nameTag;

    // Fall back to content
    const content = rootEvent.content.trim();
    if (!content) return `Comments on kind ${rootEvent.kind}`;

    const firstLine = content.split("\n")[0];
    if (firstLine && firstLine.length <= 50) return firstLine;
    if (content.length <= 50) return content;

    return content.slice(0, 47) + "...";
  }

  /**
   * Extract participants from root event
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
        participants.set(tag[1], { pubkey: tag[1], role: "member" });
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
   * Convert event to Message, handling different event types
   */
  private convertEventToMessage(
    event: NostrEvent,
    conversationId: string,
    rootEventId?: string,
  ): Message | null {
    // Zap receipts
    if (event.kind === 9735) {
      return zapReceiptToMessage(event, {
        conversationId,
        protocol: "nip-22",
      });
    }

    // Skip reactions (handled separately in UI)
    if (event.kind === 7) {
      return null;
    }

    // Comments (kind 1111) - use NIP-22 reply extraction
    if (event.kind === 1111) {
      return eventToMessage(event, {
        conversationId,
        protocol: "nip-22",
        getReplyTo: (e) => getNip22ReplyTo(e) || rootEventId,
      });
    }

    // Other events (root)
    return eventToMessage(event, {
      conversationId,
      protocol: "nip-22",
    });
  }
}
