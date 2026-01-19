import { Observable, firstValueFrom, combineLatest } from "rxjs";
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
import { normalizeURL } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import { getNip10References } from "applesauce-common/helpers";
import {
  getZapAmount,
  getZapSender,
  getZapRecipient,
} from "applesauce-common/helpers";

/**
 * NIP-10 Adapter - Threaded Notes as Chat
 *
 * Features:
 * - Turn any kind 1 note thread into a chat interface
 * - Root event displayed prominently at top
 * - All replies shown as chat messages
 * - Proper NIP-10 tag structure (root/reply markers)
 * - Smart relay selection (merges multiple sources)
 *
 * Thread ID format: nevent1... or note1...
 * Events use "e" tags with markers ("root", "reply")
 */
export class Nip10Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-10" as const;
  readonly type = "group" as const; // Threads are multi-participant like groups

  /**
   * Parse identifier - accepts nevent or note format
   * Examples:
   *   - nevent1qqsxyz... (with relay hints, author, kind)
   *   - note1abc... (simple event ID)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try note format first (simpler)
    if (input.startsWith("note1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "note") {
          const eventId = decoded.data as string;
          return {
            type: "thread",
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

          // If kind is specified and NOT kind 1, let other adapters handle
          if (kind !== undefined && kind !== 1) {
            return null;
          }

          return {
            type: "thread",
            value: { id, relays, author, kind },
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
   * Resolve conversation from thread identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (identifier.type !== "thread") {
      throw new Error(
        `NIP-10 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const pointer = identifier.value;
    const relayHints = identifier.relays || [];

    // 1. Fetch the provided event
    const providedEvent = await this.fetchEvent(pointer.id, relayHints);
    if (!providedEvent) {
      throw new Error("Event not found");
    }

    if (providedEvent.kind !== 1) {
      throw new Error(`Expected kind 1 note, got kind ${providedEvent.kind}`);
    }

    // 2. Parse NIP-10 references to find root
    const refs = getNip10References(providedEvent);
    let rootEvent: NostrEvent;
    let rootId: string;

    if (refs.root?.e) {
      // This is a reply - fetch the root
      rootId = refs.root.e.id;

      const fetchedRoot = await this.fetchEvent(
        rootId,
        refs.root.e.relays || [],
      );
      if (!fetchedRoot) {
        throw new Error("Thread root not found");
      }
      rootEvent = fetchedRoot;
    } else {
      // No root reference - this IS the root
      rootEvent = providedEvent;
      rootId = providedEvent.id;
    }

    // 3. Determine conversation relays
    const conversationRelays = await this.getThreadRelays(
      rootEvent,
      providedEvent,
      relayHints,
    );

    // 4. Extract title from root content
    const title = this.extractTitle(rootEvent);

    // 5. Build participants list from root and provided event
    const participants = this.extractParticipants(rootEvent, providedEvent);

    // 6. Build conversation object
    return {
      id: `nip-10:${rootId}`,
      type: "group",
      protocol: "nip-10",
      title,
      participants,
      metadata: {
        rootEventId: rootId,
        providedEventId: providedEvent.id,
        description: rootEvent.content.slice(0, 200), // First 200 chars
        relays: conversationRelays,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a thread
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const rootEventId = conversation.metadata?.rootEventId;
    const relays = conversation.metadata?.relays || [];

    if (!rootEventId) {
      throw new Error("Root event ID required");
    }

    // Build filter for all thread events:
    // - kind 1: replies to root
    // - kind 7: reactions
    // - kind 9735: zap receipts
    const filters: Filter[] = [
      // Replies: kind 1 events with e-tag pointing to root
      {
        kinds: [1],
        "#e": [rootEventId],
        limit: options?.limit || 100,
      },
      // Reactions: kind 7 events with e-tag pointing to root or replies
      {
        kinds: [7],
        "#e": [rootEventId],
        limit: 200, // Reactions are small, fetch more
      },
      // Zaps: kind 9735 receipts with e-tag pointing to root or replies
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
    const conversationId = `nip-10:${rootEventId}`;
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
    // Combine root event with replies
    const rootEvent$ = eventStore.event(rootEventId);
    const replies$ = eventStore.timeline({
      kinds: [1, 7, 9735],
      "#e": [rootEventId],
    });

    return combineLatest([rootEvent$, replies$]).pipe(
      map(([rootEvent, replyEvents]) => {
        const messages: Message[] = [];

        // Add root event as first message
        if (rootEvent) {
          const rootMessage = this.rootEventToMessage(
            rootEvent,
            conversationId,
            rootEventId,
          );
          if (rootMessage) {
            messages.push(rootMessage);
          }
        }

        // Convert replies to messages
        const replyMessages = replyEvents
          .map((event) =>
            this.eventToMessage(event, conversationId, rootEventId),
          )
          .filter((msg): msg is Message => msg !== null);

        messages.push(...replyMessages);

        // Sort by timestamp ascending (chronological order)
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
    );
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const rootEventId = conversation.metadata?.rootEventId;
    const relays = conversation.metadata?.relays || [];

    if (!rootEventId) {
      throw new Error("Root event ID required");
    }

    // Same filters as loadMessages but with until for pagination
    const filters: Filter[] = [
      {
        kinds: [1],
        "#e": [rootEventId],
        until: before,
        limit: 50,
      },
      {
        kinds: [7],
        "#e": [rootEventId],
        until: before,
        limit: 100,
      },
      {
        kinds: [9735],
        "#e": [rootEventId],
        until: before,
        limit: 50,
      },
    ];

    // One-shot request to fetch older messages
    const events = await firstValueFrom(
      pool.request(relays, filters, { eventStore }).pipe(toArray()),
    );

    const conversationId = `nip-10:${rootEventId}`;

    // Convert events to messages
    const messages = events
      .map((event) => this.eventToMessage(event, conversationId, rootEventId))
      .filter((msg): msg is Message => msg !== null);

    // Reverse for ascending chronological order
    return messages.reverse();
  }

  /**
   * Send a message (reply) to the thread
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
    const relays = conversation.metadata?.relays || [];

    if (!rootEventId) {
      throw new Error("Root event ID required");
    }

    // Fetch root event for building tags
    const rootEvent = await firstValueFrom(eventStore.event(rootEventId), {
      defaultValue: undefined,
    });
    if (!rootEvent) {
      throw new Error("Root event not found in store");
    }

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    // Build NIP-10 tags
    const tags: string[][] = [];

    // Determine if we're replying to root or to another reply
    if (options?.replyTo && options.replyTo !== rootEventId) {
      // Replying to another reply
      const parentEvent = await firstValueFrom(
        eventStore.event(options.replyTo),
        { defaultValue: undefined },
      );

      if (!parentEvent) {
        throw new Error("Parent event not found");
      }

      // Add root marker (always first)
      tags.push(["e", rootEventId, relays[0] || "", "root", rootEvent.pubkey]);

      // Add reply marker (the direct parent)
      tags.push([
        "e",
        options.replyTo,
        relays[0] || "",
        "reply",
        parentEvent.pubkey,
      ]);

      // Add p-tag for root author
      tags.push(["p", rootEvent.pubkey]);

      // Add p-tag for parent author (if different)
      if (parentEvent.pubkey !== rootEvent.pubkey) {
        tags.push(["p", parentEvent.pubkey]);
      }

      // Add p-tags from parent event (all mentioned users)
      for (const tag of parentEvent.tags) {
        if (tag[0] === "p" && tag[1]) {
          const pubkey = tag[1];
          // Don't duplicate tags
          if (!tags.some((t) => t[0] === "p" && t[1] === pubkey)) {
            tags.push(["p", pubkey]);
          }
        }
      }
    } else {
      // Replying directly to root
      tags.push(["e", rootEventId, relays[0] || "", "root", rootEvent.pubkey]);

      // Add p-tag for root author
      tags.push(["p", rootEvent.pubkey]);

      // Add p-tags from root event
      for (const tag of rootEvent.tags) {
        if (tag[0] === "p" && tag[1]) {
          const pubkey = tag[1];
          // Don't duplicate tags
          if (!tags.some((t) => t[0] === "p" && t[1] === pubkey)) {
            tags.push(["p", pubkey]);
          }
        }
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

    // Create and sign kind 1 event
    const draft = await factory.build({ kind: 1, content, tags });
    const event = await factory.sign(draft);

    // Publish to conversation relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Send a reaction (kind 7) to a message in the thread
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

    // Fetch the message being reacted to
    const messageEvent = await firstValueFrom(eventStore.event(messageId), {
      defaultValue: undefined,
    });

    if (!messageEvent) {
      throw new Error("Message event not found");
    }

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["e", messageId], // Event being reacted to
      ["k", "1"], // Kind of event being reacted to
      ["p", messageEvent.pubkey], // Author of message
    ];

    // Add NIP-30 custom emoji tag if provided
    if (customEmoji) {
      tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
    }

    // Create and sign kind 7 event
    const draft = await factory.build({ kind: 7, content: emoji, tags });
    const event = await factory.sign(draft);

    // Publish to conversation relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Get zap configuration for a message in a NIP-10 thread
   * Returns configuration for how zap requests should be constructed
   */
  getZapConfig(message: Message, conversation: Conversation): ZapConfig {
    // Get relays from conversation metadata
    const relays = conversation.metadata?.relays || [];

    // Build eventPointer for the message being zapped
    const eventPointer = {
      id: message.id,
      author: message.author,
      relays,
    };

    // Recipient is the message author
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
    // First check EventStore - might already be loaded
    const cachedEvent = await eventStore
      .event(eventId)
      .pipe(first())
      .toPromise();
    if (cachedEvent) {
      return cachedEvent;
    }

    // Not in store, fetch from conversation relays
    const relays = conversation.metadata?.relays || [];
    if (relays.length === 0) {
      console.warn("[NIP-10] No relays for loading reply message");
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
   * Get capabilities of NIP-10 protocol
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
   * Extract a readable title from root event content
   */
  private extractTitle(rootEvent: NostrEvent): string {
    const content = rootEvent.content.trim();
    if (!content) return `Thread by ${rootEvent.pubkey.slice(0, 8)}...`;

    // Try to get first line
    const firstLine = content.split("\n")[0];
    if (firstLine && firstLine.length <= 50) {
      return firstLine;
    }

    // Truncate to 50 chars
    if (content.length <= 50) {
      return content;
    }

    return content.slice(0, 47) + "...";
  }

  /**
   * Extract unique participants from thread
   */
  private extractParticipants(
    rootEvent: NostrEvent,
    providedEvent: NostrEvent,
  ): Participant[] {
    const participants = new Map<string, Participant>();

    // Root author is always first
    participants.set(rootEvent.pubkey, {
      pubkey: rootEvent.pubkey,
      role: "op", // Root author is "op" (original poster) of the thread
    });

    // Add p-tags from root event
    for (const tag of rootEvent.tags) {
      if (tag[0] === "p" && tag[1] && tag[1] !== rootEvent.pubkey) {
        participants.set(tag[1], {
          pubkey: tag[1],
          role: "member",
        });
      }
    }

    // Add provided event author (if different)
    if (providedEvent.pubkey !== rootEvent.pubkey) {
      participants.set(providedEvent.pubkey, {
        pubkey: providedEvent.pubkey,
        role: "member",
      });
    }

    // Add p-tags from provided event
    for (const tag of providedEvent.tags) {
      if (tag[0] === "p" && tag[1] && tag[1] !== providedEvent.pubkey) {
        participants.set(tag[1], {
          pubkey: tag[1],
          role: "member",
        });
      }
    }

    return Array.from(participants.values());
  }

  /**
   * Determine best relays for the thread
   * Includes relays from root author, provided event author, p-tagged participants, and active user
   */
  private async getThreadRelays(
    rootEvent: NostrEvent,
    providedEvent: NostrEvent,
    providedRelays: string[],
  ): Promise<string[]> {
    const relays = new Set<string>();

    // 1. Provided relay hints
    providedRelays.forEach((r) => relays.add(normalizeURL(r)));

    // 2. Root author's outbox relays (NIP-65) - highest priority
    try {
      const rootOutbox = await this.getOutboxRelays(rootEvent.pubkey);
      rootOutbox.slice(0, 3).forEach((r) => relays.add(normalizeURL(r)));
    } catch (err) {
      console.warn("[NIP-10] Failed to get root author outbox:", err);
    }

    // 3. Collect unique participant pubkeys from both events' p-tags
    const participantPubkeys = new Set<string>();

    // Add p-tags from root event
    for (const tag of rootEvent.tags) {
      if (tag[0] === "p" && tag[1]) {
        participantPubkeys.add(tag[1]);
      }
    }

    // Add p-tags from provided event
    for (const tag of providedEvent.tags) {
      if (tag[0] === "p" && tag[1]) {
        participantPubkeys.add(tag[1]);
      }
    }

    // Add provided event author if different from root
    if (providedEvent.pubkey !== rootEvent.pubkey) {
      participantPubkeys.add(providedEvent.pubkey);
    }

    // 4. Fetch outbox relays from participant subset (limit to avoid slowdown)
    // Take first 5 participants to get relay diversity without excessive fetching
    const participantsToCheck = Array.from(participantPubkeys).slice(0, 5);
    for (const pubkey of participantsToCheck) {
      try {
        const outbox = await this.getOutboxRelays(pubkey);
        // Add 1 relay from each participant for diversity
        if (outbox.length > 0) {
          relays.add(normalizeURL(outbox[0]));
        }
      } catch (_err) {
        // Silently continue if participant has no relay list
      }
    }

    // 5. Active user's outbox (for publishing replies)
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey && !participantPubkeys.has(activePubkey)) {
      try {
        const userOutbox = await this.getOutboxRelays(activePubkey);
        userOutbox.slice(0, 2).forEach((r) => relays.add(normalizeURL(r)));
      } catch (err) {
        console.warn("[NIP-10] Failed to get user outbox:", err);
      }
    }

    // 6. Fallback to aggregator relays if we have too few
    if (relays.size < 3) {
      AGGREGATOR_RELAYS.forEach((r) => relays.add(r));
    }

    // Limit to 10 relays max for performance
    return Array.from(relays).slice(0, 10);
  }

  /**
   * Helper: Get outbox relays for a pubkey (NIP-65)
   */
  private async getOutboxRelays(pubkey: string): Promise<string[]> {
    const relayList = await firstValueFrom(
      eventStore.replaceable(10002, pubkey, ""),
      { defaultValue: undefined },
    );

    if (!relayList) return [];

    // Extract write relays (r tags with "write" or no marker)
    return relayList.tags
      .filter((t) => {
        if (t[0] !== "r") return false;
        const marker = t[2];
        return !marker || marker === "write";
      })
      .map((t) => normalizeURL(t[1]))
      .slice(0, 5); // Limit to 5
  }

  /**
   * Helper: Fetch an event by ID from relays
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

    // Not in store - fetch from relays
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
            // EOSE received
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            // Event received
            events.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error(`[NIP-10] Fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Helper: Get default relays to use when no hints provided
   */
  private async getDefaultRelays(): Promise<string[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey) {
      const outbox = await this.getOutboxRelays(activePubkey);
      if (outbox.length > 0) return outbox.slice(0, 5);
    }

    // Fallback to aggregator relays
    return AGGREGATOR_RELAYS;
  }

  /**
   * Convert root event to Message object
   */
  private rootEventToMessage(
    event: NostrEvent,
    conversationId: string,
    _rootEventId: string,
  ): Message | null {
    if (event.kind !== 1) {
      return null;
    }

    // Root event has no replyTo field
    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo: undefined,
      protocol: "nip-10",
      metadata: {
        encrypted: false,
      },
      event,
    };
  }

  /**
   * Convert Nostr event to Message object
   */
  private eventToMessage(
    event: NostrEvent,
    conversationId: string,
    rootEventId: string,
  ): Message | null {
    // Handle zap receipts (kind 9735)
    if (event.kind === 9735) {
      return this.zapToMessage(event, conversationId);
    }

    // Handle reactions (kind 7) - skip for now, handled via MessageReactions
    if (event.kind === 7) {
      return null;
    }

    // Handle replies (kind 1)
    if (event.kind === 1) {
      const refs = getNip10References(event);

      // Determine what this reply is responding to
      let replyTo: string | undefined;

      if (refs.reply?.e) {
        // Replying to another reply
        replyTo = refs.reply.e.id;
      } else if (refs.root?.e) {
        // Replying directly to root
        replyTo = refs.root.e.id;
      } else {
        // Malformed or legacy reply - assume replying to root
        replyTo = rootEventId;
      }

      return {
        id: event.id,
        conversationId,
        author: event.pubkey,
        content: event.content,
        timestamp: event.created_at,
        type: "user",
        replyTo,
        protocol: "nip-10",
        metadata: {
          encrypted: false,
        },
        event,
      };
    }

    console.warn(`[NIP-10] Unknown event kind: ${event.kind}`);
    return null;
  }

  /**
   * Convert zap receipt to Message object
   */
  private zapToMessage(
    zapReceipt: NostrEvent,
    conversationId: string,
  ): Message {
    // Extract zap metadata using applesauce helpers
    const amount = getZapAmount(zapReceipt);
    const sender = getZapSender(zapReceipt);
    const recipient = getZapRecipient(zapReceipt);

    // Convert from msats to sats
    const amountInSats = amount ? Math.floor(amount / 1000) : 0;

    // Find what event is being zapped (e-tag in zap receipt)
    const eTag = zapReceipt.tags.find((t) => t[0] === "e");
    const replyTo = eTag?.[1];

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
      author: sender || zapReceipt.pubkey,
      content: comment,
      timestamp: zapReceipt.created_at,
      type: "zap",
      replyTo,
      protocol: "nip-10",
      metadata: {
        zapAmount: amountInSats,
        zapRecipient: recipient,
      },
      event: zapReceipt,
    };
  }
}
