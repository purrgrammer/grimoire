import { Observable, firstValueFrom, combineLatest } from "rxjs";
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
import { EventFactory } from "applesauce-core/event-factory";
import { getNip10References } from "applesauce-common/helpers";
import {
  fetchEvent,
  getOutboxRelays,
  mergeRelays,
  zapReceiptToMessage,
  eventToMessage,
  AGGREGATOR_RELAYS,
} from "../utils";

const LOG_PREFIX = "[NIP-10]";

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
    const providedEvent = await fetchEvent(pointer.id, {
      relayHints,
      logPrefix: LOG_PREFIX,
    });

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

      const fetchedRoot = await fetchEvent(rootId, {
        relayHints: refs.root.e.relays || [],
        logPrefix: LOG_PREFIX,
      });

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
    const conversationRelays = await this.buildRelays(
      rootEvent,
      providedEvent,
      relayHints,
    );

    // 4. Build conversation object
    return {
      id: `nip-10:${rootId}`,
      type: "group",
      protocol: "nip-10",
      title: this.extractTitle(rootEvent),
      participants: this.extractParticipants(rootEvent, providedEvent),
      metadata: {
        rootEventId: rootId,
        providedEventId: providedEvent.id,
        description: rootEvent.content.slice(0, 200),
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

    const conversationId = `nip-10:${rootEventId}`;

    // Build filters for thread events
    const filters: Filter[] = [
      { kinds: [1], "#e": [rootEventId], limit: options?.limit || 100 },
      { kinds: [7], "#e": [rootEventId], limit: 200 },
      { kinds: [9735], "#e": [rootEventId], limit: 100 },
    ];

    if (options?.before) filters[0].until = options.before;
    if (options?.after) filters[0].since = options.after;

    // Cleanup existing subscription
    this.cleanup(conversationId);

    // Start persistent subscription
    const subscription = pool
      .subscription(relays, filters, { eventStore })
      .subscribe();

    this.subscriptions.set(conversationId, subscription);

    // Return observable from EventStore
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
          messages.push(
            eventToMessage(rootEvent, {
              conversationId,
              protocol: "nip-10",
            }),
          );
        }

        // Convert replies to messages
        for (const event of replyEvents) {
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

    const filters: Filter[] = [
      { kinds: [1], "#e": [rootEventId], until: before, limit: 50 },
      { kinds: [7], "#e": [rootEventId], until: before, limit: 100 },
      { kinds: [9735], "#e": [rootEventId], until: before, limit: 50 },
    ];

    const events = await firstValueFrom(
      pool.request(relays, filters, { eventStore }).pipe(toArray()),
    );

    const conversationId = `nip-10:${rootEventId}`;

    return events
      .map((e) => this.convertEventToMessage(e, conversationId, rootEventId))
      .filter((msg): msg is Message => msg !== null)
      .reverse();
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

    const rootEvent = await firstValueFrom(eventStore.event(rootEventId), {
      defaultValue: undefined,
    });
    if (!rootEvent) {
      throw new Error("Root event not found in store");
    }

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [];

    // Build NIP-10 tags based on reply target
    if (options?.replyTo && options.replyTo !== rootEventId) {
      // Replying to another reply
      const parentEvent = await firstValueFrom(
        eventStore.event(options.replyTo),
        { defaultValue: undefined },
      );

      if (!parentEvent) {
        throw new Error("Parent event not found");
      }

      tags.push(["e", rootEventId, relays[0] || "", "root", rootEvent.pubkey]);
      tags.push([
        "e",
        options.replyTo,
        relays[0] || "",
        "reply",
        parentEvent.pubkey,
      ]);
      tags.push(["p", rootEvent.pubkey]);

      if (parentEvent.pubkey !== rootEvent.pubkey) {
        tags.push(["p", parentEvent.pubkey]);
      }

      // Add p-tags from parent event
      for (const tag of parentEvent.tags) {
        if (
          tag[0] === "p" &&
          tag[1] &&
          !tags.some((t) => t[0] === "p" && t[1] === tag[1])
        ) {
          tags.push(["p", tag[1]]);
        }
      }
    } else {
      // Replying directly to root
      tags.push(["e", rootEventId, relays[0] || "", "root", rootEvent.pubkey]);
      tags.push(["p", rootEvent.pubkey]);

      for (const tag of rootEvent.tags) {
        if (
          tag[0] === "p" &&
          tag[1] &&
          !tags.some((t) => t[0] === "p" && t[1] === tag[1])
        ) {
          tags.push(["p", tag[1]]);
        }
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

    const draft = await factory.build({ kind: 1, content, tags });
    const event = await factory.sign(draft);

    await publishEventToRelays(event, relays);
  }

  /**
   * Send a reaction (kind 7) to a message
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
      ["k", "1"],
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

  // --- Private helpers ---

  /**
   * Build relay list from thread participants
   */
  private async buildRelays(
    rootEvent: NostrEvent,
    providedEvent: NostrEvent,
    providedRelays: string[],
  ): Promise<string[]> {
    const relaySources: string[][] = [providedRelays];

    // Root author's outbox
    const rootOutbox = await getOutboxRelays(rootEvent.pubkey, {
      maxRelays: 3,
    });
    relaySources.push(rootOutbox);

    // Collect participant pubkeys
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

    // Add one relay from each participant (limit to 5)
    for (const pubkey of Array.from(participantPubkeys).slice(0, 5)) {
      const outbox = await getOutboxRelays(pubkey, { maxRelays: 1 });
      if (outbox.length > 0) relaySources.push(outbox);
    }

    // Active user's outbox
    const activePubkey = accountManager.active$.value?.pubkey;
    if (activePubkey && !participantPubkeys.has(activePubkey)) {
      const userOutbox = await getOutboxRelays(activePubkey, { maxRelays: 2 });
      relaySources.push(userOutbox);
    }

    return mergeRelays(relaySources, {
      maxRelays: 10,
      minRelays: 3,
      fallbackRelays: AGGREGATOR_RELAYS,
    });
  }

  /**
   * Extract title from root event
   */
  private extractTitle(rootEvent: NostrEvent): string {
    const content = rootEvent.content.trim();
    if (!content) return `Thread by ${rootEvent.pubkey.slice(0, 8)}...`;

    const firstLine = content.split("\n")[0];
    if (firstLine && firstLine.length <= 50) return firstLine;
    if (content.length <= 50) return content;

    return content.slice(0, 47) + "...";
  }

  /**
   * Extract participants from thread
   */
  private extractParticipants(
    rootEvent: NostrEvent,
    providedEvent: NostrEvent,
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

    // Add provided event author
    if (providedEvent.pubkey !== rootEvent.pubkey) {
      participants.set(providedEvent.pubkey, {
        pubkey: providedEvent.pubkey,
        role: "member",
      });
    }

    // Add p-tags from provided event
    for (const tag of providedEvent.tags) {
      if (tag[0] === "p" && tag[1] && !participants.has(tag[1])) {
        participants.set(tag[1], { pubkey: tag[1], role: "member" });
      }
    }

    return Array.from(participants.values());
  }

  /**
   * Convert event to Message, handling different types
   */
  private convertEventToMessage(
    event: NostrEvent,
    conversationId: string,
    rootEventId: string,
  ): Message | null {
    // Zap receipts
    if (event.kind === 9735) {
      return zapReceiptToMessage(event, {
        conversationId,
        protocol: "nip-10",
      });
    }

    // Skip reactions (handled via MessageReactions)
    if (event.kind === 7) {
      return null;
    }

    // Replies (kind 1)
    if (event.kind === 1) {
      const refs = getNip10References(event);

      const getReplyTo = (): string | undefined => {
        if (refs.reply?.e) return refs.reply.e.id;
        if (refs.root?.e) return refs.root.e.id;
        return rootEventId;
      };

      return eventToMessage(event, {
        conversationId,
        protocol: "nip-10",
        getReplyTo,
      });
    }

    console.warn(`${LOG_PREFIX} Unknown event kind: ${event.kind}`);
    return null;
  }
}
