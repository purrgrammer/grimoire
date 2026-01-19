import { Observable, combineLatest } from "rxjs";
import { map } from "rxjs/operators";
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
import { normalizeURL } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import { getZapAmount, getZapSender } from "applesauce-common/helpers";
import { getRootEventTitle } from "@/lib/nostr-utils";

/**
 * NIP-22 Adapter - Comment Threads as Chat
 *
 * Features:
 * - Turn any event's comment thread into a chat interface
 * - Root event (any kind) displayed as first message
 * - All kind 1111 comments shown as chat messages
 * - Proper NIP-22 tag structure (uppercase K/E/P for root, lowercase k/e/p for parent)
 * - Smart relay selection (root author outbox + commenter outboxes)
 * - Support for nested comment replies
 *
 * Thread ID format: note1.../nevent1.../naddr1...
 * Events use uppercase tags for root scope, lowercase for parent scope
 */
export class Nip22Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-22" as const;
  readonly type = "channel" as const; // Comments are public like channels

  /**
   * Parse identifier - accepts note, nevent, or naddr format
   * Examples:
   *   - note1abc... (simple event ID)
   *   - nevent1qqsxyz... (with relay hints, author, kind)
   *   - naddr1... (addressable event for kind 30000-39999)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try note format (simpler event ID)
    if (input.startsWith("note1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "note") {
          const eventId = decoded.data as string;
          return {
            type: "comment-thread",
            value: { id: eventId },
            relays: [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try nevent format (includes relay hints)
    if (input.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nevent") {
          const { id, relays, author, kind } = decoded.data;

          // If kind is 1, let NIP-10 adapter handle it (kind 1 uses replies, not comments)
          if (kind === 1) {
            return null;
          }

          return {
            type: "comment-thread",
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

          // Addressable events are kind 30000-39999
          if (kind < 30000 || kind >= 40000) {
            return null;
          }

          return {
            type: "comment-thread",
            value: {
              kind,
              pubkey,
              identifier,
              relays,
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
   * Resolve conversation from comment thread identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (identifier.type !== "comment-thread") {
      throw new Error(
        `NIP-22 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const pointer = identifier.value;
    const relayHints = identifier.relays || [];

    // 1. Fetch the root event
    let rootEvent: NostrEvent;
    let rootId: string;

    if (pointer.id) {
      // Regular event (note, nevent)
      const fetched = await this.fetchEvent(pointer.id, relayHints);
      if (!fetched) {
        throw new Error("Event not found");
      }
      rootEvent = fetched;
      rootId = fetched.id;
    } else if (
      pointer.kind &&
      pointer.pubkey &&
      pointer.identifier !== undefined
    ) {
      // Addressable event (naddr)
      const fetched = await this.fetchAddressableEvent(
        pointer.kind,
        pointer.pubkey,
        pointer.identifier,
        relayHints,
      );
      if (!fetched) {
        throw new Error("Addressable event not found");
      }
      rootEvent = fetched;
      rootId = fetched.id;
    } else {
      throw new Error("Invalid comment thread identifier");
    }

    // 2. Determine conversation relays
    const conversationRelays = await this.getCommentThreadRelays(
      rootEvent,
      relayHints,
    );

    // 3. Extract title from root event
    const title = getRootEventTitle(rootEvent);

    // 4. Build initial participants (root author as "op")
    const participants: Participant[] = [
      {
        pubkey: rootEvent.pubkey,
        role: "op", // Original poster
      },
    ];

    // 5. Build conversation object
    return {
      id: `nip-22:${rootId}`,
      type: "channel",
      protocol: "nip-22",
      title,
      participants,
      metadata: {
        rootEventId: rootId,
        rootEventKind: rootEvent.kind,
        description: title,
        relays: conversationRelays,
        commentCount: 0,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a comment thread
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const rootEventId = conversation.metadata?.rootEventId;
    const rootEventKind = conversation.metadata?.rootEventKind;
    const relays = conversation.metadata?.relays || [];

    if (!rootEventId || !rootEventKind) {
      throw new Error("Root event ID and kind required");
    }

    // Build filter for all thread events:
    // - kind 1111: comments on root
    // - kind 7: reactions
    // - kind 9735: zap receipts
    const filters: Filter[] = [
      // Comments: kind 1111 events with K and E tags pointing to root
      {
        kinds: [1111],
        "#K": [rootEventKind.toString()],
        "#E": [rootEventId],
        limit: options?.limit || 100,
      },
      // Reactions: kind 7 events with e-tag pointing to root or comments
      {
        kinds: [7],
        "#e": [rootEventId],
        limit: 200, // Reactions are small, fetch more
      },
      // Zaps: kind 9735 receipts with e-tag pointing to root or comments
      {
        kinds: [9735],
        "#e": [rootEventId],
        limit: 100,
      },
    ];

    if (options?.before) {
      filters[0].until = options.before;
    }
    if (options?.after) {
      filters[0].since = options.after;
    }

    // Clean up any existing subscription
    const conversationId = `nip-22:${rootEventId}`;
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

    // Return observable from EventStore
    // Combine root event with comments
    const rootEvent$ = eventStore.event(rootEventId);
    const comments$ = eventStore.timeline({
      kinds: [1111, 7, 9735],
      "#E": [rootEventId],
      "#K": [rootEventKind.toString()],
    });

    return combineLatest([rootEvent$, comments$]).pipe(
      map(([rootEvent, commentEvents]) => {
        if (!rootEvent) return [];

        // Convert root event to first message
        const rootMessage = this.rootEventToMessage(rootEvent, conversationId);

        // Convert comment events to messages
        const messages = commentEvents
          .map((event) =>
            this.eventToMessage(event, conversationId, rootEventId),
          )
          .filter((m): m is Message => m !== null);

        // Combine and sort by timestamp (ascending)
        return [rootMessage, ...messages].sort(
          (a, b) => a.timestamp - b.timestamp,
        );
      }),
    );
  }

  /**
   * Load more messages (pagination)
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const messages = await this.loadMessages(conversation, {
      before,
      limit: 50,
    }).toPromise();
    return messages || [];
  }

  /**
   * Send a message (create kind 1111 comment)
   */
  async sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const rootEventId = conversation.metadata?.rootEventId;
    const rootEventKind = conversation.metadata?.rootEventKind;
    const relays = conversation.metadata?.relays || [];

    if (!rootEventId || !rootEventKind) {
      throw new Error("Root event ID and kind required");
    }

    // Get active signer
    const activeAccount = accountManager.active$.value;
    if (!activeAccount?.signer) {
      throw new Error("No active account with signer");
    }

    // Fetch root event for metadata
    const rootEvent = await eventStore.event(rootEventId).toPromise();
    if (!rootEvent) {
      throw new Error("Root event not found in store");
    }

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeAccount.signer);

    // Build NIP-22 tags
    const tags: string[][] = [
      // Root scope (uppercase tags)
      ["K", rootEventKind.toString()],
      ["E", rootEventId, relays[0] || ""],
      ["P", rootEvent.pubkey],
    ];

    // If replying to another comment (nested), add parent scope (lowercase tags)
    if (options?.replyTo) {
      const parentComment = await eventStore.event(options.replyTo).toPromise();
      if (parentComment) {
        tags.push(
          ["k", "1111"], // Parent is a comment
          ["e", options.replyTo, relays[0] || ""],
          ["p", parentComment.pubkey],
        );

        // Include all p-tags from parent (mentioned participants)
        const parentPTags = parentComment.tags.filter((t) => t[0] === "p");
        for (const pTag of parentPTags) {
          // Avoid duplicates
          if (!tags.some((t) => t[0] === "p" && t[1] === pTag[1])) {
            tags.push(pTag);
          }
        }
      }
    } else {
      // Top-level comment - add k tag for self-reference
      tags.push(["k", "1111"]);
    }

    // Add optional NIP-30 custom emoji tags
    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    // Add optional NIP-92 imeta blob tags
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        tags.push(["imeta", ...imetaParts]);
      }
    }

    // Create and sign event
    const draft = await factory.build({
      kind: 1111,
      content,
      tags,
    });

    const event = await factory.sign(draft);

    // Publish to conversation relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Send a reaction (kind 7)
   */
  async sendReaction(
    conversation: Conversation,
    messageId: string,
    emoji: string,
    customEmoji?: { shortcode: string; url: string },
  ): Promise<void> {
    const relays = conversation.metadata?.relays || [];

    // Get active signer
    const activeAccount = accountManager.active$.value;
    if (!activeAccount?.signer) {
      throw new Error("No active account with signer");
    }

    // Fetch the message event
    const messageEvent = await eventStore.event(messageId).toPromise();
    if (!messageEvent) {
      throw new Error("Message event not found");
    }

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeAccount.signer);

    // Build kind 7 tags
    const tags: string[][] = [
      ["e", messageId],
      ["k", messageEvent.kind.toString()],
      ["p", messageEvent.pubkey],
    ];

    // Add NIP-30 custom emoji tag if provided
    if (customEmoji) {
      tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
    }

    // Create and sign reaction event
    const draft = await factory.build({
      kind: 7,
      content: emoji,
      tags,
    });

    const event = await factory.sign(draft);

    // Publish to conversation relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Get chat capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsThreading: true, // Nested comment replies
      supportsReactions: true, // Kind 7
      supportsZaps: true, // Kind 9735
      supportsEncryption: false, // Public comments
      supportsModeration: false, // No relay enforcement
      supportsRoles: true, // "op" for root author
      supportsGroupManagement: false,
      requiresRelay: false, // Multi-relay distribution
    };
  }

  /**
   * Load a replied-to message
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    const event = await eventStore.event(eventId).toPromise();
    return event || null;
  }

  /**
   * Get zap configuration for a message
   */
  getZapConfig(message: Message, conversation: Conversation): ZapConfig {
    const relays = conversation.metadata?.relays || [];

    return {
      supported: true,
      recipientPubkey: message.author, // Zap the commenter
      eventPointer: {
        id: message.id,
        author: message.author,
        relays,
      },
    };
  }

  // ========== Private Helper Methods ==========

  /**
   * Fetch a regular event by ID
   */
  private async fetchEvent(
    eventId: string,
    relayHints: string[],
  ): Promise<NostrEvent | null> {
    // Try EventStore first (local cache)
    const cached = await eventStore.event(eventId).toPromise();
    if (cached) return cached;

    // Fetch from relays if not cached
    const relays = relayHints.length > 0 ? relayHints : AGGREGATOR_RELAYS;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe();
        resolve(null);
      }, 5000);

      const sub = pool
        .subscription(relays, [{ ids: [eventId] }], { eventStore })
        .subscribe({
          next: (response) => {
            if (typeof response === "string") {
              // EOSE received
              clearTimeout(timeout);
              sub.unsubscribe();
              resolve(null);
            } else if (response.id === eventId) {
              // Event received
              clearTimeout(timeout);
              sub.unsubscribe();
              resolve(response);
            }
          },
        });
    });
  }

  /**
   * Fetch an addressable event (kind 30000-39999)
   */
  private async fetchAddressableEvent(
    kind: number,
    pubkey: string,
    identifier: string,
    relayHints: string[],
  ): Promise<NostrEvent | null> {
    // Try EventStore first (local cache)
    const cached = await eventStore
      .replaceable(kind, pubkey, identifier)
      .toPromise();
    if (cached) return cached;

    // Fetch from relays if not cached
    const relays = relayHints.length > 0 ? relayHints : AGGREGATOR_RELAYS;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe();
        resolve(null);
      }, 5000);

      const sub = pool
        .subscription(
          relays,
          [
            {
              kinds: [kind],
              authors: [pubkey],
              "#d": [identifier],
              limit: 1,
            },
          ],
          { eventStore },
        )
        .subscribe({
          next: (response) => {
            if (typeof response === "string") {
              // EOSE received
              clearTimeout(timeout);
              sub.unsubscribe();
              resolve(null);
            } else {
              // Event received
              clearTimeout(timeout);
              sub.unsubscribe();
              resolve(response);
            }
          },
        });
    });
  }

  /**
   * Determine relays for comment thread
   */
  private async getCommentThreadRelays(
    rootEvent: NostrEvent,
    providedHints: string[],
  ): Promise<string[]> {
    const relaySet = new Set<string>();

    // 1. Add provided relay hints (highest priority)
    for (const relay of providedHints) {
      if (relay) {
        relaySet.add(normalizeURL(relay));
      }
    }

    // 2. Add root author's outbox relays (NIP-65)
    try {
      const rootOutbox = await this.getOutboxRelays(rootEvent.pubkey);
      for (const relay of rootOutbox.slice(0, 3)) {
        relaySet.add(normalizeURL(relay));
      }
    } catch {
      // Ignore errors
    }

    // 3. Add active user's outbox relays (for receiving responses)
    const activeAccount = accountManager.active$.value;
    if (activeAccount?.pubkey) {
      try {
        const userOutbox = await this.getOutboxRelays(activeAccount.pubkey);
        for (const relay of userOutbox.slice(0, 3)) {
          relaySet.add(normalizeURL(relay));
        }
      } catch {
        // Ignore errors
      }
    }

    // 4. Add aggregator relays as fallback
    if (relaySet.size < 5) {
      for (const relay of AGGREGATOR_RELAYS.slice(0, 5 - relaySet.size)) {
        relaySet.add(normalizeURL(relay));
      }
    }

    return Array.from(relaySet);
  }

  /**
   * Get outbox relays for a pubkey (NIP-65)
   */
  private async getOutboxRelays(pubkey: string): Promise<string[]> {
    const relayList = await eventStore
      .replaceable(10002, pubkey, "")
      .toPromise();

    if (!relayList) return [];

    // Extract write relays (r tags with "write" marker or no marker)
    const relays: string[] = [];
    for (const tag of relayList.tags) {
      if (tag[0] === "r") {
        const relayUrl = tag[1];
        const marker = tag[2];
        if (!marker || marker === "write") {
          relays.push(relayUrl);
        }
      }
    }

    return relays;
  }

  /**
   * Convert root event to message (first message in thread)
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
      type: "system", // Root event is special
      protocol: "nip-22",
      metadata: {
        isRootMessage: true, // Flag for special rendering
        encrypted: false,
      },
      event,
    };
  }

  /**
   * Convert event to message
   */
  private eventToMessage(
    event: NostrEvent,
    conversationId: string,
    rootEventId: string,
  ): Message | null {
    // Handle kind 9735 (zap receipts) -> convert to zap message
    if (event.kind === 9735) {
      return this.zapToMessage(event, conversationId);
    }

    // Skip kind 7 (reactions) - handled via MessageReactions component
    if (event.kind === 7) {
      return null;
    }

    // Handle kind 1111 (comments)
    if (event.kind === 1111) {
      // Determine reply target using NIP-22 structure
      let replyTo: string | undefined;

      // Check lowercase e tag (parent comment)
      const parentETag = event.tags.find(
        (t) => t[0] === "e" && t[1] !== rootEventId,
      );
      if (parentETag) {
        replyTo = parentETag[1];
      }

      // If no parent comment, top-level comment (no replyTo)

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

    return null;
  }

  /**
   * Convert zap receipt (kind 9735) to zap message
   */
  private zapToMessage(
    zapReceipt: NostrEvent,
    conversationId: string,
  ): Message | null {
    try {
      // Extract zap metadata
      const amount = getZapAmount(zapReceipt);
      const sender = getZapSender(zapReceipt);

      if (!amount || !sender) {
        return null; // Invalid zap
      }

      // Convert msats to sats
      const sats = Math.floor(amount / 1000);

      // Find zapped event/comment
      const eTag = zapReceipt.tags.find((t) => t[0] === "e");
      const zappedEventId = eTag?.[1];

      // Get zap request event for comment
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
        author: sender,
        content: comment, // Zap comment (optional)
        timestamp: zapReceipt.created_at,
        type: "zap",
        replyTo: zappedEventId, // Link to zapped comment
        protocol: "nip-22",
        metadata: {
          encrypted: false,
          zapAmount: sats,
        },
        event: zapReceipt,
      };
    } catch {
      return null;
    }
  }
}
