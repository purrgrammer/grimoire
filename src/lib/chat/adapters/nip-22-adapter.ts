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
  Participant,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import {
  AGGREGATOR_RELAYS,
  eventLoader,
  addressLoader,
} from "@/services/loaders";
import { mergeRelaySets, getOutboxes } from "applesauce-core/helpers";
import {
  getEventPointerFromETag,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import { EventFactory } from "applesauce-core/event-factory";
import {
  ReactionBlueprint,
  CommentBlueprint,
} from "applesauce-common/blueprints";
import { getCommentReplyPointer } from "applesauce-common/helpers";
import {
  getZapAmount,
  getZapSender,
  getZapRecipient,
} from "applesauce-common/helpers";

/**
 * NIP-22 Adapter - Event Comments as Chat
 *
 * Features:
 * - Turn any event into a threaded chat interface
 * - Root event displayed prominently (using its appropriate renderer)
 * - All comments (kind 1111) shown as chat messages
 * - A-tag based threading (supports addressable and regular events)
 * - Catch-all for any event type (after specialized adapters)
 *
 * Thread ID format: nevent1.../naddr1.../note1...
 * Comments use "A" tags to reference root event
 */
export class Nip22Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-22" as const;
  readonly type = "group" as const; // Comments are multi-participant like groups

  /**
   * Parse identifier - accepts nevent, naddr, or note format
   * This is a catch-all adapter, so it accepts any event reference
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try note format (simple event ID)
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

    // Try nevent format (event with relay hints)
    if (input.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nevent") {
          const { id, relays, author, kind } = decoded.data;

          // Accept any kind for NIP-22 (catch-all)
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

    // Try naddr format (addressable event)
    if (input.startsWith("naddr1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "naddr") {
          const { kind, pubkey, identifier, relays } = decoded.data;

          // Accept any addressable kind for NIP-22 (catch-all)
          return {
            type: "thread",
            value: {
              id: `${kind}:${pubkey}:${identifier}`, // Pseudo-ID for addressable events
              relays,
              author: pubkey,
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
   * Resolve conversation from thread identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    if (identifier.type !== "thread") {
      throw new Error(
        `NIP-22 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const pointer = identifier.value;
    const relayHints = identifier.relays || [];

    // 1. Fetch the provided event using eventLoader (properly checks EventStore cache)
    console.log(
      `[NIP-22] Resolving conversation from event ${pointer.id.slice(0, 8)}`,
    );

    const providedEvent = await firstValueFrom(
      eventLoader(
        { id: pointer.id, kind: pointer.kind, relays: relayHints },
        pointer.author,
      ),
    );

    if (!providedEvent) {
      console.warn(
        `[NIP-22] Provided event ${pointer.id.slice(0, 8)} not found`,
      );
      throw new Error("Event not found");
    }

    console.log(
      `[NIP-22] Found provided event ${pointer.id.slice(0, 8)} (kind ${providedEvent.kind})`,
    );

    // 2. Determine root event based on kind
    let rootEvent: NostrEvent;
    let rootId: string;
    let rootCoordinate: string | undefined;

    if (providedEvent.kind === 1111) {
      // This is a comment - find the root via A-tag
      const rootPointer = getCommentReplyPointer(providedEvent);
      if (!rootPointer) {
        throw new Error("Comment has no A-tag root reference");
      }

      if (rootPointer.type === "event" && rootPointer.id) {
        // Regular event pointer
        rootId = rootPointer.id;
        const eventPointer: EventPointer = {
          id: rootPointer.id,
          kind: rootPointer.kind,
          author: rootPointer.pubkey,
          relays: rootPointer.relay ? [rootPointer.relay] : undefined,
        };
        const fetchedRoot = await this.fetchEventByPointer(
          eventPointer,
          relayHints,
          providedEvent, // Pass comment event for relay hint extraction
        );
        if (!fetchedRoot) {
          throw new Error("Comment root not found");
        }
        rootEvent = fetchedRoot;
      } else if (
        rootPointer.type === "address" &&
        rootPointer.pubkey &&
        rootPointer.identifier !== undefined
      ) {
        // Addressable event pointer
        rootCoordinate = `${rootPointer.kind}:${rootPointer.pubkey}:${rootPointer.identifier}`;
        rootId = rootCoordinate; // Use coordinate as pseudo-ID
        const addressPointer: AddressPointer = {
          kind: rootPointer.kind,
          pubkey: rootPointer.pubkey,
          identifier: rootPointer.identifier,
          relays: rootPointer.relay ? [rootPointer.relay] : undefined,
        };
        const fetchedRoot = await this.fetchAddressableEvent(
          addressPointer,
          relayHints,
          providedEvent, // Pass comment event for relay hint extraction
        );
        if (!fetchedRoot) {
          throw new Error("Comment root not found");
        }
        rootEvent = fetchedRoot;
      } else {
        throw new Error("Unsupported comment root pointer type");
      }
    } else {
      // Not a comment - this IS the root
      rootEvent = providedEvent;
      rootId = providedEvent.id;

      // Check if this is an addressable event (kind 30000-39999)
      if (rootEvent.kind >= 30000 && rootEvent.kind < 40000) {
        const dTag = rootEvent.tags.find((t) => t[0] === "d")?.[1] || "";
        rootCoordinate = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        rootId = rootCoordinate; // Use coordinate as primary ID
      }
    }

    // 3. Determine conversation relays
    const conversationRelays = await this.getThreadRelays(
      rootEvent,
      providedEvent,
      relayHints,
    );

    // 4. Extract title from root event
    const title = this.extractTitle(rootEvent);

    // 5. Build participants list
    const participants = this.extractParticipants(rootEvent, providedEvent);

    // 6. Build conversation object
    return {
      id: `nip-22:${rootId}`,
      type: "group",
      protocol: "nip-22",
      title,
      participants,
      metadata: {
        rootEventId: rootEvent.id,
        providedEventId: providedEvent.id,
        description: rootEvent.content.slice(0, 200), // First 200 chars
        relays: conversationRelays,
        // Store coordinate for addressable events
        ...(rootCoordinate && { rootCoordinate }),
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
    const rootCoordinate = conversation.metadata?.rootCoordinate;
    const relays = conversation.metadata?.relays || [];

    if (!rootEventId) {
      throw new Error("Root event ID required");
    }

    // Unified identifier for conversation ID
    const conversationRef = rootCoordinate || rootEventId;

    // Build filters based on event type:
    // - Addressable events: use #a filter with coordinate
    // - Regular events: use #E filter with event ID (uppercase E per NIP-22)
    const filters: Filter[] = [];

    if (rootCoordinate) {
      // Addressable event - use #a filter
      filters.push(
        {
          kinds: [1111],
          "#a": [rootCoordinate],
          limit: options?.limit || 100,
        },
        {
          kinds: [16],
          "#a": [rootCoordinate],
          limit: 100,
        },
        {
          kinds: [9735],
          "#a": [rootCoordinate],
          limit: 100,
        },
      );
    } else {
      // Regular event - use #E filter (uppercase E per NIP-22)
      filters.push(
        {
          kinds: [1111],
          "#E": [rootEventId],
          limit: options?.limit || 100,
        },
        {
          kinds: [16],
          "#E": [rootEventId],
          limit: 100,
        },
        {
          kinds: [9735],
          "#E": [rootEventId],
          limit: 100,
        },
      );
    }

    if (options?.before) {
      filters[0].until = options.before;
    }
    if (options?.after) {
      filters[0].since = options.after;
    }

    // Clean up any existing subscription
    const conversationId = `nip-22:${conversationRef}`;
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

    // Build timeline filter based on event type
    const timelineFilter = rootCoordinate
      ? { kinds: [1111, 16, 9735], "#a": [rootCoordinate] }
      : { kinds: [1111, 16, 9735], "#E": [rootEventId] };

    const comments$ = eventStore.timeline(timelineFilter);

    return combineLatest([rootEvent$, comments$]).pipe(
      map(([rootEvent, commentEvents]) => {
        const messages: Message[] = [];

        // Add root event as first message
        if (rootEvent) {
          const rootMessage = this.rootEventToMessage(
            rootEvent,
            conversationId,
            conversationRef,
          );
          if (rootMessage) {
            messages.push(rootMessage);
          }
        }

        // Convert comments to messages
        const commentMessages = commentEvents
          .map((event) =>
            this.eventToMessage(event, conversationId, conversationRef),
          )
          .filter((msg): msg is Message => msg !== null);

        messages.push(...commentMessages);

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
    const rootCoordinate = conversation.metadata?.rootCoordinate;
    const relays = conversation.metadata?.relays || [];

    if (!rootEventId) {
      throw new Error("Root event ID required");
    }

    const conversationRef = rootCoordinate || rootEventId;

    // Build filters based on event type (same logic as loadMessages)
    const filters: Filter[] = [];

    if (rootCoordinate) {
      // Addressable event - use #a filter
      filters.push(
        {
          kinds: [1111],
          "#a": [rootCoordinate],
          until: before,
          limit: 50,
        },
        {
          kinds: [16],
          "#a": [rootCoordinate],
          until: before,
          limit: 50,
        },
        {
          kinds: [9735],
          "#a": [rootCoordinate],
          until: before,
          limit: 50,
        },
      );
    } else {
      // Regular event - use #E filter
      filters.push(
        {
          kinds: [1111],
          "#E": [rootEventId],
          until: before,
          limit: 50,
        },
        {
          kinds: [16],
          "#E": [rootEventId],
          until: before,
          limit: 50,
        },
        {
          kinds: [9735],
          "#E": [rootEventId],
          until: before,
          limit: 50,
        },
      );
    }

    // One-shot request to fetch older messages
    const events = await firstValueFrom(
      pool.request(relays, filters, { eventStore }).pipe(toArray()),
    );

    const conversationId = `nip-22:${conversationRef}`;

    // Convert events to messages
    const messages = events
      .map((event) =>
        this.eventToMessage(event, conversationId, conversationRef),
      )
      .filter((msg): msg is Message => msg !== null);

    // Reverse for ascending chronological order
    return messages.reverse();
  }

  /**
   * Send a message (comment) to the thread
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

    // Get root event
    const rootEvent = await firstValueFrom(eventStore.event(rootEventId), {
      defaultValue: undefined,
    });

    if (!rootEvent) {
      throw new Error("Root event not found in store");
    }

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    // Determine parent for the comment
    // If replying to a comment, parent is that comment; otherwise parent is root event
    let parent: NostrEvent;
    if (options?.replyTo) {
      const parentEvent = await firstValueFrom(
        eventStore.event(options.replyTo),
        { defaultValue: undefined },
      );
      if (!parentEvent) {
        throw new Error("Reply parent event not found");
      }
      parent = parentEvent;
    } else {
      parent = rootEvent;
    }

    // Build comment using CommentBlueprint
    const blueprintOptions: any = {};
    if (options?.emojiTags) {
      blueprintOptions.emoji = options.emojiTags;
    }
    if (options?.blobAttachments) {
      blueprintOptions.imeta = options.blobAttachments.map((blob) => ({
        url: blob.url,
        x: blob.sha256,
        m: blob.mimeType,
        size: blob.size?.toString(),
      }));
    }

    // Create draft using blueprint
    const draft = await factory.create(
      CommentBlueprint,
      parent,
      content,
      blueprintOptions,
    );

    // Sign the event
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

    // Use ReactionBlueprint - auto-handles e-tag, k-tag, p-tag, custom emoji
    const emojiArg = customEmoji
      ? { shortcode: customEmoji.shortcode, url: customEmoji.url }
      : emoji;

    const draft = await factory.create(
      ReactionBlueprint,
      messageEvent,
      emojiArg,
    );

    // Sign the event
    const event = await factory.sign(draft);

    // Publish to conversation relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Get zap configuration for a message in a NIP-22 thread
   */
  getZapConfig(message: Message, conversation: Conversation): ZapConfig {
    const relays = conversation.metadata?.relays || [];

    // Build eventPointer for the message being zapped
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
   * Load a replied-to message by pointer
   */
  async loadReplyMessage(
    conversation: Conversation,
    pointer: EventPointer | AddressPointer,
  ): Promise<NostrEvent | null> {
    // Extract event ID from pointer
    const eventId = "id" in pointer ? pointer.id : null;

    if (!eventId) {
      console.warn(
        "[NIP-22] AddressPointer not supported for loadReplyMessage",
      );
      return null;
    }

    // First check EventStore
    const cachedEvent = await eventStore
      .event(eventId)
      .pipe(first())
      .toPromise();
    if (cachedEvent) {
      return cachedEvent;
    }

    // Build relay list
    const conversationRelays = conversation.metadata?.relays || [];
    const relays = mergeRelaySets(conversationRelays, pointer.relays || []);

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
    // Try to get title tag first (common for addressable events)
    const titleTag = rootEvent.tags.find((t) => t[0] === "title")?.[1];
    if (titleTag && titleTag.trim()) {
      return titleTag.length > 50 ? titleTag.slice(0, 47) + "..." : titleTag;
    }

    // Try to get subject tag (common for some events)
    const subjectTag = rootEvent.tags.find((t) => t[0] === "subject")?.[1];
    if (subjectTag && subjectTag.trim()) {
      return subjectTag.length > 50
        ? subjectTag.slice(0, 47) + "..."
        : subjectTag;
    }

    // Fall back to content
    const content = rootEvent.content.trim();
    if (!content) {
      return `Event ${rootEvent.kind} by ${rootEvent.pubkey.slice(0, 8)}...`;
    }

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

    // Root author is always first (OP)
    participants.set(rootEvent.pubkey, {
      pubkey: rootEvent.pubkey,
      role: "op",
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
   */
  private async getThreadRelays(
    rootEvent: NostrEvent,
    providedEvent: NostrEvent,
    providedRelays: string[],
  ): Promise<string[]> {
    const relaySets: string[][] = [];

    // 1. Provided relay hints (highest priority)
    relaySets.push(providedRelays);

    // 2. Root author's outbox relays (NIP-65)
    try {
      const rootOutbox = await this.getOutboxRelays(rootEvent.pubkey);
      relaySets.push(rootOutbox.slice(0, 3));
    } catch (err) {
      console.warn("[NIP-22] Failed to get root author outbox:", err);
    }

    // 3. Collect unique participant pubkeys from both events' p-tags
    const participantPubkeys = new Set<string>();
    for (const tag of rootEvent.tags) {
      if (tag[0] === "p" && tag[1]) participantPubkeys.add(tag[1]);
    }
    for (const tag of providedEvent.tags) {
      if (tag[0] === "p" && tag[1]) participantPubkeys.add(tag[1]);
    }
    if (providedEvent.pubkey !== rootEvent.pubkey) {
      participantPubkeys.add(providedEvent.pubkey);
    }

    // 4. Fetch outbox relays from participant subset
    const participantsToCheck = Array.from(participantPubkeys).slice(0, 5);
    for (const pubkey of participantsToCheck) {
      try {
        const outbox = await this.getOutboxRelays(pubkey);
        if (outbox.length > 0) relaySets.push([outbox[0]]);
      } catch {
        // Silently continue
      }
    }

    // 5. Active user's outbox (for publishing comments)
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey && !participantPubkeys.has(activePubkey)) {
      try {
        const userOutbox = await this.getOutboxRelays(activePubkey);
        relaySets.push(userOutbox.slice(0, 2));
      } catch (err) {
        console.warn("[NIP-22] Failed to get user outbox:", err);
      }
    }

    // Merge all relay sets
    let relays = mergeRelaySets(...relaySets);

    // 6. Fallback to aggregator relays if we have too few
    if (relays.length < 3) {
      relays = mergeRelaySets(relays, AGGREGATOR_RELAYS);
    }

    // Limit to 10 relays max for performance
    return relays.slice(0, 10);
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

    return getOutboxes(relayList).slice(0, 5);
  }

  /**
   * Helper: Fetch event by EventPointer using eventLoader
   * EventLoader properly checks EventStore cache first, then uses smart relay selection
   */
  private async fetchEventByPointer(
    pointer: EventPointer,
    _additionalHints: string[] = [],
    commentEvent?: NostrEvent,
  ): Promise<NostrEvent | null> {
    console.log(
      `[NIP-22] Fetching root event ${pointer.id.slice(0, 8)} via eventLoader (comment: ${commentEvent?.id.slice(0, 8) || "none"})`,
    );

    try {
      // Use eventLoader which:
      // 1. Checks EventStore cache first (proper observable handling)
      // 2. Extracts relay hints from context event (comment)
      // 3. Uses smart relay selection (author outbox, seen relays, etc.)
      // 4. Falls back to aggregators
      const event = await firstValueFrom(
        eventLoader(pointer, commentEvent || pointer.author),
      );

      if (event) {
        console.log(
          `[NIP-22] Found root event ${pointer.id.slice(0, 8)} in cache or via relays`,
        );
      } else {
        console.warn(`[NIP-22] Root event ${pointer.id.slice(0, 8)} not found`);
      }

      return event || null;
    } catch (error) {
      console.error(
        `[NIP-22] Error fetching root event ${pointer.id.slice(0, 8)}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Helper: Fetch addressable event by AddressPointer using addressLoader
   * AddressLoader properly checks EventStore cache first, then uses smart relay selection
   */
  private async fetchAddressableEvent(
    pointer: AddressPointer,
    _additionalHints: string[] = [],
    commentEvent?: NostrEvent,
  ): Promise<NostrEvent | null> {
    const { kind, pubkey, identifier } = pointer;
    const coordinate = `${kind}:${pubkey}:${identifier}`;

    console.log(
      `[NIP-22] Fetching addressable root ${coordinate} via addressLoader (comment: ${commentEvent?.id.slice(0, 8) || "none"})`,
    );

    try {
      // Use addressLoader which:
      // 1. Checks EventStore replaceable cache first (proper observable handling)
      // 2. Uses author's outbox relays for discovery
      // 3. Falls back to aggregators (via extraRelays config)
      // Note: addressLoader doesn't take context, so we can't pass comment event
      // but it still uses author outbox which is the most important source
      const event = await firstValueFrom(
        addressLoader({ kind, pubkey, identifier }),
      );

      if (event) {
        console.log(
          `[NIP-22] Found addressable root ${coordinate} in cache or via relays`,
        );
      } else {
        console.warn(`[NIP-22] Addressable root ${coordinate} not found`);
      }

      return event || null;
    } catch (error) {
      console.error(
        `[NIP-22] Error fetching addressable root ${coordinate}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Convert root event to Message object
   * Root event is rendered as a card using KindRenderer for better UX
   */
  private rootEventToMessage(
    event: NostrEvent,
    conversationId: string,
    _aTagValue: string,
  ): Message | null {
    // Root event has no replyTo field and is rendered as a card
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
        renderAsCard: true, // Render using KindRenderer for nice event card
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
    aTagValue: string,
  ): Message | null {
    // Handle zap receipts (kind 9735)
    if (event.kind === 9735) {
      return this.zapToMessage(event, conversationId);
    }

    // Handle reposts (kind 16 only) - simple system messages
    if (event.kind === 16) {
      return this.repostToMessage(event, conversationId);
    }

    // Handle reactions (kind 7) - skip for now, handled via MessageReactions
    if (event.kind === 7) {
      return null;
    }

    // Handle comments (kind 1111)
    if (event.kind === 1111) {
      // Determine what this comment is responding to
      let replyTo: EventPointer | AddressPointer | undefined;

      // Check for reply to another comment (e-tag with "reply" marker)
      const replyETag = event.tags.find(
        (t) => t[0] === "e" && t[3] === "reply",
      );
      if (replyETag) {
        const ePointer = getEventPointerFromETag(replyETag);
        if (ePointer) {
          replyTo = ePointer;
        }
      } else {
        // Not replying to a comment - replying to root
        // Parse A-tag to get root reference
        const aTag = event.tags.find((t) => t[0] === "a" && t[1] === aTagValue);
        if (aTag) {
          const parsed = parseReplaceableAddress(aTag[1]);
          if (parsed) {
            replyTo = {
              kind: parsed.kind,
              pubkey: parsed.pubkey,
              identifier: parsed.identifier,
              relays: aTag[2] ? [aTag[2]] : undefined,
            };
          }
        }
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
        metadata: {
          encrypted: false,
        },
        event,
      };
    }

    console.warn(`[NIP-22] Unknown event kind: ${event.kind}`);
    return null;
  }

  /**
   * Convert zap receipt to Message object
   */
  private zapToMessage(
    zapReceipt: NostrEvent,
    conversationId: string,
  ): Message {
    const amount = getZapAmount(zapReceipt);
    const sender = getZapSender(zapReceipt);
    const recipient = getZapRecipient(zapReceipt);

    const amountInSats = amount ? Math.floor(amount / 1000) : 0;

    // Find what event is being zapped (a-tag or e-tag in zap receipt)
    const aTag = zapReceipt.tags.find((t) => t[0] === "a");
    const eTag = zapReceipt.tags.find((t) => t[0] === "e");

    let replyTo: EventPointer | AddressPointer | undefined;

    if (aTag) {
      const parsed = parseReplaceableAddress(aTag[1]);
      if (parsed) {
        replyTo = {
          kind: parsed.kind,
          pubkey: parsed.pubkey,
          identifier: parsed.identifier,
          relays: aTag[2] ? [aTag[2]] : undefined,
        };
      }
    } else if (eTag) {
      const ePointer = getEventPointerFromETag(eTag);
      if (ePointer) {
        replyTo = ePointer;
      }
    }

    // Get zap request comment
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
        zapAmount: amountInSats,
        zapRecipient: recipient,
      },
      event: zapReceipt,
    };
  }

  /**
   * Convert repost event to system Message object
   */
  private repostToMessage(
    repostEvent: NostrEvent,
    conversationId: string,
  ): Message {
    // Find what event is being reposted (a-tag or e-tag)
    const aTag = repostEvent.tags.find((t) => t[0] === "a");
    const eTag = repostEvent.tags.find((t) => t[0] === "e");

    let replyTo: EventPointer | AddressPointer | undefined;

    if (aTag) {
      const parsed = parseReplaceableAddress(aTag[1]);
      if (parsed) {
        replyTo = {
          kind: parsed.kind,
          pubkey: parsed.pubkey,
          identifier: parsed.identifier,
          relays: aTag[2] ? [aTag[2]] : undefined,
        };
      }
    } else if (eTag) {
      const ePointer = getEventPointerFromETag(eTag);
      if (ePointer) {
        replyTo = ePointer;
      }
    }

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
}
