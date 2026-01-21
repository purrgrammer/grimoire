import { Observable, firstValueFrom } from "rxjs";
import { map, first } from "rxjs/operators";
import { nip19 } from "nostr-tools";
import type { Filter } from "nostr-tools";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
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
import { publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";
import { isNip05, resolveNip05 } from "@/lib/nip05";
import { getDisplayName } from "@/lib/nostr-utils";
import { getTagValues } from "@/lib/nostr-utils";
import { isValidHexPubkey } from "@/lib/nostr-validation";
import { getProfileContent } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import { ReactionBlueprint } from "applesauce-common/blueprints";

/**
 * NIP-C7 Adapter - Simple Chat (Kind 9)
 *
 * Features:
 * - Direct messaging between users
 * - Quote-based threading (q-tag)
 * - No encryption
 * - Uses outbox relays
 */
export class NipC7Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-c7" as const;
  readonly type = "dm" as const;

  /**
   * Parse identifier - accepts npub, nprofile, hex pubkey, or NIP-05
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try bech32 decoding (npub/nprofile)
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "npub") {
        return {
          type: "chat-partner",
          value: decoded.data,
        };
      }
      if (decoded.type === "nprofile") {
        return {
          type: "chat-partner",
          value: decoded.data.pubkey,
          relays: decoded.data.relays,
        };
      }
    } catch {
      // Not bech32, try other formats
    }

    // Try hex pubkey
    if (isValidHexPubkey(input)) {
      return {
        type: "chat-partner",
        value: input,
      };
    }

    // Try NIP-05
    if (isNip05(input)) {
      return {
        type: "chat-partner-nip05",
        value: input,
      };
    }

    return null;
  }

  /**
   * Resolve conversation from identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    let pubkey: string;

    // Resolve NIP-05 if needed
    if (identifier.type === "chat-partner-nip05") {
      const resolved = await resolveNip05(identifier.value);
      if (!resolved) {
        throw new Error(`Failed to resolve NIP-05: ${identifier.value}`);
      }
      pubkey = resolved;
    } else if (
      identifier.type === "chat-partner" ||
      identifier.type === "dm-recipient"
    ) {
      pubkey = identifier.value;
    } else {
      throw new Error(
        `NIP-C7 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    // Get display name for partner
    const metadataEvent = await this.getMetadata(pubkey);
    const metadata = metadataEvent
      ? getProfileContent(metadataEvent)
      : undefined;
    const title = getDisplayName(pubkey, metadata);

    return {
      id: `nip-c7:${pubkey}`,
      type: "dm",
      protocol: "nip-c7",
      title,
      participants: [
        { pubkey: activePubkey, role: "member" },
        { pubkey, role: "member" },
      ],
      unreadCount: 0,
    };
  }

  /**
   * Load messages between active user and conversation partner
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    const partner = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    );
    if (!partner) {
      throw new Error("No conversation partner found");
    }

    // Subscribe to kind 9 messages between users
    const filter: Filter = {
      kinds: [9],
      authors: [activePubkey, partner.pubkey],
      "#p": [activePubkey, partner.pubkey],
      limit: options?.limit || 50,
    };

    if (options?.before) {
      filter.until = options.before;
    }
    if (options?.after) {
      filter.since = options.after;
    }

    // Start subscription to populate EventStore
    pool
      .subscription([], [filter], {
        eventStore, // Automatically add to store
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE received
            console.log("[NIP-C7] EOSE received for messages");
          } else {
            // Event received
            console.log(
              `[NIP-C7] Received message: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    // Return observable from EventStore which will update automatically
    return eventStore.timeline(filter).pipe(
      map((events) => {
        console.log(`[NIP-C7] Timeline has ${events.length} messages`);
        return events
          .map((event) => this.eventToMessage(event, conversation.id))
          .sort((a, b) => a.timestamp - b.timestamp);
      }),
    );
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    // For now, return empty - pagination to be implemented in Phase 6
    return [];
  }

  /**
   * Send a message
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

    const partner = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    );
    if (!partner) {
      throw new Error("No conversation partner found");
    }

    // Create event factory and sign event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [["p", partner.pubkey]];
    if (options?.replyTo) {
      tags.push(["q", options.replyTo]); // NIP-C7 quote tag for threading
    }

    // Add NIP-30 emoji tags
    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    const draft = await factory.build({ kind: 9, content, tags });
    const event = await factory.sign(draft);
    await publishEvent(event);
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

    const partner = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    );
    if (!partner) {
      throw new Error("No conversation partner found");
    }

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

    // Note: ReactionBlueprint already adds p-tag for message author
    // For NIP-C7, we might want to ensure partner is tagged if different from author
    // but the blueprint should handle this correctly

    // Sign the event
    const event = await factory.sign(draft);
    await publishEvent(event);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false,
      supportsThreading: true, // q-tag quotes
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      canCreateConversations: true,
      requiresRelay: false,
    };
  }

  /**
   * Load a replied-to message
   * First checks EventStore, then fetches from relays if needed
   */
  async loadReplyMessage(
    _conversation: Conversation,
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

    // Not in store, fetch from relay pool
    console.log(`[NIP-C7] Fetching reply message ${eventId.slice(0, 8)}...`);

    const filter: Filter = {
      ids: [eventId],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription([], [filter], { eventStore }); // Empty relay list = use global pool

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(
          `[NIP-C7] Reply message fetch timeout for ${eventId.slice(0, 8)}...`,
        );
        resolve();
      }, 3000);

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
          console.error(`[NIP-C7] Reply message fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Helper: Convert Nostr event to Message
   */
  private eventToMessage(event: NostrEvent, conversationId: string): Message {
    const quotedEventIds = getTagValues(event, "q");

    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      replyTo: quotedEventIds[0], // First q tag
      protocol: "nip-c7",
      event,
    };
  }

  /**
   * Helper: Get user metadata
   */
  private async getMetadata(pubkey: string): Promise<NostrEvent | undefined> {
    return firstValueFrom(eventStore.replaceable(0, pubkey), {
      defaultValue: undefined,
    });
  }
}
