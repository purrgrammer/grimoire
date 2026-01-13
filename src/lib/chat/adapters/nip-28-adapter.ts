import { Observable, firstValueFrom } from "rxjs";
import { map, first, toArray } from "rxjs/operators";
import type { Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import type { ChatAction, GetActionsOptions } from "@/types/chat-actions";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";
import { getTagValues } from "@/lib/nostr-utils";
import { EventFactory } from "applesauce-core/event-factory";

/**
 * NIP-28 Adapter - Public Chat Channels
 *
 * Features:
 * - Open public channels (no membership required)
 * - Client-side moderation (hide/mute)
 * - Channel metadata (name, about, picture, relays)
 * - Messages with NIP-10 threading
 *
 * Channel ID format: note1.../nevent1... (kind 40 channel creation event)
 * Events use "e" tag to reference the channel (root tag)
 */
export class Nip28Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-28" as const;
  readonly type = "channel" as const;

  /**
   * Parse identifier - accepts note/nevent pointing to kind 40
   * Examples:
   *   - note1abcdef... (kind 40 channel creation event)
   *   - nevent1... (kind 40 with relay hints)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try note format (just event ID)
    if (input.startsWith("note1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "note") {
          return {
            type: "channel",
            value: decoded.data,
            relays: [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try nevent format (event ID with relay hints)
    if (input.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nevent") {
          return {
            type: "channel",
            value: decoded.data.id,
            relays: decoded.data.relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Resolve conversation from channel identifier
   * Fetches kind 40 (creation) and kind 41 (latest metadata)
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    // This adapter only handles channel identifiers
    if (identifier.type !== "channel") {
      throw new Error(
        `NIP-28 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const channelId = identifier.value;
    const relayHints = identifier.relays || [];

    console.log(
      `[NIP-28] Fetching channel ${channelId.slice(0, 8)}... from relays`,
    );

    // First, fetch the kind 40 channel creation event
    const creationFilter: Filter = {
      kinds: [40],
      ids: [channelId],
      limit: 1,
    };

    // Try relay hints first, then fall back to pool
    const relaysToQuery = relayHints.length > 0 ? relayHints : pool.urls$.value;

    const creationEvents: NostrEvent[] = [];
    const creationObs = pool.subscription(relaysToQuery, [creationFilter], {
      eventStore,
    });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-28] Channel creation fetch timeout");
        resolve();
      }, 5000);

      const sub = creationObs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE received
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            // Event received
            creationEvents.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-28] Channel creation fetch error:", err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    const creationEvent = creationEvents[0];

    if (!creationEvent) {
      throw new Error(
        `Channel creation event not found: ${channelId.slice(0, 8)}...`,
      );
    }

    console.log(
      `[NIP-28] Found channel creation event by ${creationEvent.pubkey}`,
    );

    // Parse metadata from kind 40 content (JSON)
    let metadata: any = {};
    try {
      metadata = JSON.parse(creationEvent.content);
    } catch (e) {
      console.warn("[NIP-28] Failed to parse channel metadata:", e);
    }

    // Now fetch latest kind 41 metadata update (if any)
    // Kind 41 events should be from the same pubkey as kind 40
    const metadataFilter: Filter = {
      kinds: [41],
      "#e": [channelId],
      authors: [creationEvent.pubkey],
      limit: 1,
    };

    const metadataEvents: NostrEvent[] = [];
    const metadataObs = pool.subscription(relaysToQuery, [metadataFilter], {
      eventStore,
    });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-28] Metadata update fetch timeout");
        resolve();
      }, 3000);

      const sub = metadataObs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            metadataEvents.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-28] Metadata update fetch error:", err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    // If kind 41 exists, use it to override kind 40 metadata
    const metadataUpdate = metadataEvents[0];
    if (metadataUpdate) {
      try {
        const updatedMetadata = JSON.parse(metadataUpdate.content);
        metadata = { ...metadata, ...updatedMetadata };
        console.log("[NIP-28] Applied metadata update from kind 41");
      } catch (e) {
        console.warn("[NIP-28] Failed to parse metadata update:", e);
      }
    }

    // Extract channel info
    const title = metadata.name || `Channel ${channelId.slice(0, 8)}...`;
    const description = metadata.about;
    const icon = metadata.picture;
    const relays = metadata.relays || [];

    console.log(`[NIP-28] Channel title: ${title}`);

    return {
      id: `nip-28:${channelId}`,
      type: "channel",
      protocol: "nip-28",
      title,
      participants: [], // NIP-28 channels don't track participants
      metadata: {
        channelEvent: creationEvent,
        ...(description && { description }),
        ...(icon && { icon }),
        ...(relays.length > 0 && { relayUrl: relays[0] }), // Store first relay
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a channel
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const channelEvent = conversation.metadata?.channelEvent;

    if (!channelEvent) {
      throw new Error("Channel event required");
    }

    const channelId = channelEvent.id;

    console.log(
      `[NIP-28] Loading messages for channel ${channelId.slice(0, 8)}...`,
    );

    // Determine relays to query
    let relays: string[] = [];

    // Try metadata relays first
    const channelMetadata = channelEvent.content
      ? (() => {
          try {
            return JSON.parse(channelEvent.content);
          } catch {
            return {};
          }
        })()
      : {};

    if (channelMetadata.relays && Array.isArray(channelMetadata.relays)) {
      relays = channelMetadata.relays;
    }

    // Fall back to pool if no relay hints
    if (relays.length === 0) {
      relays = pool.urls$.value;
    }

    console.log(`[NIP-28] Querying ${relays.length} relays for messages`);

    // Filter for kind 42 messages referencing this channel
    // Messages should have an "e" tag (root) pointing to the channel
    const filter: Filter = {
      kinds: [42],
      "#e": [channelId],
      limit: options?.limit || 50,
    };

    if (options?.before) {
      filter.until = options.before;
    }
    if (options?.after) {
      filter.since = options.after;
    }

    // Clean up any existing subscription for this conversation
    const conversationId = `nip-28:${channelId}`;
    this.cleanup(conversationId);

    // Start a persistent subscription
    const subscription = pool
      .subscription(relays, [filter], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[NIP-28] EOSE received");
          } else {
            console.log(
              `[NIP-28] Received message: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    // Store subscription for cleanup
    this.subscriptions.set(conversationId, subscription);

    // Return observable from EventStore which will update automatically
    return eventStore.timeline(filter).pipe(
      map((events) => {
        const messages = events.map((event) =>
          this.eventToMessage(event, conversation.id),
        );

        console.log(`[NIP-28] Timeline has ${messages.length} messages`);

        // EventStore returns events in desc order, reverse for chat
        return messages.reverse();
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
    const channelEvent = conversation.metadata?.channelEvent;

    if (!channelEvent) {
      throw new Error("Channel event required");
    }

    const channelId = channelEvent.id;

    console.log(
      `[NIP-28] Loading older messages for ${channelId.slice(0, 8)}... before ${before}`,
    );

    // Determine relays
    let relays: string[] = [];
    const channelMetadata = (() => {
      try {
        return JSON.parse(channelEvent.content);
      } catch {
        return {};
      }
    })();

    if (channelMetadata.relays && Array.isArray(channelMetadata.relays)) {
      relays = channelMetadata.relays;
    } else {
      relays = pool.urls$.value;
    }

    const filter: Filter = {
      kinds: [42],
      "#e": [channelId],
      until: before,
      limit: 50,
    };

    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    console.log(`[NIP-28] Loaded ${events.length} older messages`);

    const messages = events.map((event) =>
      this.eventToMessage(event, conversation.id),
    );

    return messages.reverse();
  }

  /**
   * Send a message to the channel
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

    const channelEvent = conversation.metadata?.channelEvent;

    if (!channelEvent) {
      throw new Error("Channel event required");
    }

    const channelId = channelEvent.id;

    // Create event factory and sign event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    // Build tags according to NIP-28 and NIP-10
    const tags: string[][] = [];

    // Root reference to channel (NIP-10)
    tags.push(["e", channelId, "", "root"]);

    // If replying to a message, add reply reference
    if (options?.replyTo) {
      tags.push(["e", options.replyTo, "", "reply"]);

      // Also add p-tag for the author of the replied-to message
      // We need to fetch the replied-to event to get its author
      const repliedEvent = await this.loadReplyMessage(
        conversation,
        options.replyTo,
      );
      if (repliedEvent) {
        tags.push(["p", repliedEvent.pubkey]);
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

    // Use kind 42 for channel messages
    const draft = await factory.build({ kind: 42, content, tags });
    const event = await factory.sign(draft);

    // Publish to channel relays (or user's relays if no channel relays)
    await publishEvent(event);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false, // kind 42 messages are public
      supportsThreading: true, // NIP-10 e-tag replies
      supportsModeration: true, // Client-side hide/mute
      supportsRoles: false, // No roles in NIP-28
      supportsGroupManagement: false, // No join/leave
      canCreateConversations: false, // Channels created separately
      requiresRelay: false, // Can use any relays
    };
  }

  /**
   * Get available actions for NIP-28 channels
   * Returns hide and mute actions
   */
  getActions(options?: GetActionsOptions): ChatAction[] {
    return [
      {
        name: "hide",
        description: "Hide a message (client-side)",
        handler: async (context) => {
          // Kind 43 - hide message
          // This would need additional context (which message to hide)
          // For now, return a placeholder
          return {
            success: false,
            message:
              "Hide action requires message context. Use the message context menu.",
          };
        },
      },
      {
        name: "mute",
        description: "Mute a user (client-side)",
        handler: async (context) => {
          // Kind 44 - mute user
          // This would need additional context (which user to mute)
          // For now, return a placeholder
          return {
            success: false,
            message:
              "Mute action requires user context. Use the user context menu.",
          };
        },
      },
    ];
  }

  /**
   * Hide a message (kind 43)
   * Creates a client-side hide event
   */
  async hideMessage(messageId: string, reason?: string): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [["e", messageId]];

    const content = reason ? JSON.stringify({ reason }) : "";

    const draft = await factory.build({ kind: 43, content, tags });
    const event = await factory.sign(draft);

    await publishEvent(event);
  }

  /**
   * Mute a user (kind 44)
   * Creates a client-side mute event
   */
  async muteUser(pubkey: string, reason?: string): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [["p", pubkey]];

    const content = reason ? JSON.stringify({ reason }) : "";

    const draft = await factory.build({ kind: 44, content, tags });
    const event = await factory.sign(draft);

    await publishEvent(event);
  }

  /**
   * Load a replied-to message
   * First checks EventStore, then fetches from channel relays if needed
   */
  async loadReplyMessage(
    conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // First check EventStore
    const cachedEvent = await eventStore
      .event(eventId)
      .pipe(first())
      .toPromise();
    if (cachedEvent) {
      return cachedEvent;
    }

    // Not in store, fetch from channel relays
    const channelEvent = conversation.metadata?.channelEvent;
    if (!channelEvent) {
      console.warn("[NIP-28] No channel event for loading reply message");
      return null;
    }

    // Determine relays
    let relays: string[] = [];
    const channelMetadata = (() => {
      try {
        return JSON.parse(channelEvent.content);
      } catch {
        return {};
      }
    })();

    if (channelMetadata.relays && Array.isArray(channelMetadata.relays)) {
      relays = channelMetadata.relays;
    } else {
      relays = pool.urls$.value;
    }

    console.log(
      `[NIP-28] Fetching reply message ${eventId.slice(0, 8)}... from relays`,
    );

    const filter: Filter = {
      ids: [eventId],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription(relays, [filter], { eventStore });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(
          `[NIP-28] Reply message fetch timeout for ${eventId.slice(0, 8)}...`,
        );
        resolve();
      }, 3000);

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
          console.error(`[NIP-28] Reply message fetch error:`, err);
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
    // Look for reply e-tags (NIP-10)
    // Root is the channel, reply is the message being replied to
    const eTags = event.tags.filter((t) => t[0] === "e");
    const replyTag = eTags.find((t) => t[3] === "reply");
    const replyTo = replyTag?.[1];

    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo,
      protocol: "nip-28",
      metadata: {
        encrypted: false, // kind 42 messages are always public
      },
      event,
    };
  }
}
