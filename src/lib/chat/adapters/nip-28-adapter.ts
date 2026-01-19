import { Observable, firstValueFrom } from "rxjs";
import { map, toArray } from "rxjs/operators";
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
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";
import { getTagValue } from "applesauce-core/helpers";
import { getNip10References } from "applesauce-common/helpers/threading";
import { EventFactory } from "applesauce-core/event-factory";
import { mergeRelaySets } from "applesauce-core/helpers";
import { getTagValues } from "@/lib/nostr-utils";

/**
 * NIP-28 Adapter - Public Chat Channels
 *
 * Features:
 * - Open participation (anyone can post)
 * - Multi-relay coordination (no single relay authority)
 * - Client-side moderation (kinds 43/44)
 * - Channel messages (kind 42) with NIP-10 threading
 * - Channel metadata (kind 41) replaceable by creator only
 *
 * Channel ID format: note1... or nevent1... (kind 40 event ID)
 */
export class Nip28Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-28" as const;
  readonly type = "channel" as const;

  /**
   * Parse identifier - accepts note/nevent (kind 40) or naddr (kind 41)
   * Examples:
   *   - note1... (kind 40 channel creation event)
   *   - nevent1... (kind 40 with relay hints)
   *   - naddr1... (kind 41 channel metadata address)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try note format (kind 40 event ID)
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
        // Not a valid note, fall through
      }
    }

    // Try nevent format (kind 40 with relay hints)
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
        // Not a valid nevent, fall through
      }
    }

    // Try naddr format (kind 41 metadata address)
    if (input.startsWith("naddr1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "naddr" && decoded.data.kind === 41) {
          // For kind 41, we need to fetch it to get the e-tag pointing to kind 40
          // For now, return null - we'll support this later
          return null;
        }
      } catch {
        // Not a valid naddr, fall through
      }
    }

    return null;
  }

  /**
   * Resolve conversation from channel identifier
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
    const hintRelays = identifier.relays || [];

    console.log(
      `[NIP-28] Fetching channel metadata for ${channelId.slice(0, 8)}...`,
    );

    // Step 1: Fetch the kind 40 creation event
    const kind40Filter: Filter = {
      kinds: [40],
      ids: [channelId],
      limit: 1,
    };

    // Build relay list: hints + user's relay list
    const activePubkey = accountManager.active$.value?.pubkey;
    let relays = [...hintRelays];

    // Add user's outbox relays if available
    if (activePubkey) {
      try {
        const outboxEvent = await firstValueFrom(
          eventStore.replaceable(10002, activePubkey, ""),
          { defaultValue: undefined },
        );
        if (outboxEvent) {
          const outboxRelays = outboxEvent.tags
            .filter((t) => t[0] === "r")
            .map((t) => t[1]);
          relays = mergeRelaySets(relays, outboxRelays);
        }
      } catch {
        // Ignore errors fetching relay list
      }
    }

    // Fallback to default relays if none available
    if (relays.length === 0) {
      relays = [
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.nostr.band",
      ];
    }

    const kind40Events: NostrEvent[] = [];
    const kind40Obs = pool.subscription(relays, [kind40Filter], {
      eventStore,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-28] Kind 40 fetch timeout");
        resolve();
      }, 5000);

      const sub = kind40Obs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            kind40Events.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-28] Kind 40 fetch error:", err);
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    const kind40Event = kind40Events[0];

    if (!kind40Event) {
      throw new Error("Channel creation event not found");
    }

    const creatorPubkey = kind40Event.pubkey;

    // Step 2: Fetch the most recent kind 41 metadata from the creator
    const kind41Filter: Filter = {
      kinds: [41],
      authors: [creatorPubkey],
      "#e": [channelId],
      limit: 1,
    };

    const kind41Events: NostrEvent[] = [];
    const kind41Obs = pool.subscription(relays, [kind41Filter], {
      eventStore,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-28] Kind 41 fetch timeout");
        resolve();
      }, 5000);

      const sub = kind41Obs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            kind41Events.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-28] Kind 41 fetch error:", err);
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    // Parse metadata from kind 41 (or fall back to kind 40 content)
    let title: string;
    let description: string | undefined;
    let icon: string | undefined;
    let metadataRelays: string[] = [];

    const metadataEvent = kind41Events[0];

    if (metadataEvent) {
      // Parse kind 41 content as JSON
      try {
        const metadata = JSON.parse(metadataEvent.content);
        title = metadata.name || kind40Event.content || channelId.slice(0, 8);
        description = metadata.about;
        icon = metadata.picture;
        metadataRelays = metadata.relays || [];
      } catch {
        // Fall back to kind 40 content
        title = kind40Event.content || channelId.slice(0, 8);
      }
    } else {
      // No kind 41, use kind 40 content as title
      title = kind40Event.content || channelId.slice(0, 8);
    }

    // Merge relays: hints + metadata relays + user relays
    const finalRelays = mergeRelaySets(relays, metadataRelays);

    console.log(
      `[NIP-28] Channel title: ${title}, relays: ${finalRelays.length}`,
    );

    return {
      id: `nip-28:${channelId}`,
      type: "channel",
      protocol: "nip-28",
      title,
      participants: [], // NIP-28 has open participation, no membership list
      metadata: {
        channelEvent: kind40Event,
        description,
        icon,
        relayUrl: finalRelays.join(","), // Store as comma-separated for compatibility
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
      throw new Error("Channel event not found in conversation metadata");
    }

    const channelId = channelEvent.id;
    const relays = conversation.metadata?.relayUrl?.split(",") || [];

    console.log(
      `[NIP-28] Loading messages for ${channelId.slice(0, 8)}... from ${relays.length} relays`,
    );

    // Filter for kind 42 messages with root e-tag pointing to channel
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
    this.cleanup(conversation.id);

    // Start persistent subscription
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
              `[NIP-28] Received event k${response.kind}: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    // Store subscription for cleanup
    this.subscriptions.set(conversation.id, subscription);

    // Return observable from EventStore
    return eventStore.timeline(filter).pipe(
      map((events) => {
        const messages = events.map((event) =>
          this.eventToMessage(event, conversation.id, channelId),
        );

        console.log(`[NIP-28] Timeline has ${messages.length} messages`);
        // EventStore timeline returns desc, reverse for ascending
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
      throw new Error("Channel event not found in conversation metadata");
    }

    const channelId = channelEvent.id;
    const relays = conversation.metadata?.relayUrl?.split(",") || [];

    console.log(
      `[NIP-28] Loading older messages for ${channelId.slice(0, 8)}... before ${before}`,
    );

    const filter: Filter = {
      kinds: [42],
      "#e": [channelId],
      until: before,
      limit: 50,
    };

    // One-shot request
    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    console.log(`[NIP-28] Loaded ${events.length} older events`);

    const messages = events.map((event) =>
      this.eventToMessage(event, conversation.id, channelId),
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
    const activeSigner = accountManager.active$.value?.signer;
    if (!activeSigner) {
      throw new Error("No active signer");
    }

    const channelEvent = conversation.metadata?.channelEvent;
    if (!channelEvent) {
      throw new Error("Channel event not found");
    }

    const channelId = channelEvent.id;

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [];

    // Root e-tag (marked) pointing to channel
    tags.push(["e", channelId, "", "root"]);

    // Reply e-tag (marked) if replying
    if (options?.replyTo) {
      tags.push(["e", options.replyTo, "", "reply"]);

      // Add p-tag for the author of the replied message
      // Fetch the replied message to get author pubkey
      try {
        const repliedEvent = await firstValueFrom(
          eventStore.event(options.replyTo),
          { defaultValue: undefined },
        );
        if (repliedEvent) {
          tags.push(["p", repliedEvent.pubkey]);
        }
      } catch {
        // Ignore if we can't fetch the replied message
      }
    }

    // Add p-tag for channel creator (recommended by NIP-28)
    tags.push(["p", channelEvent.pubkey]);

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

    // Create kind 42 message
    const draft = await factory.build({ kind: 42, content, tags });
    const event = await factory.sign(draft);

    // Publish to all channel relays
    await publishEvent(event);
  }

  /**
   * Send a reaction (kind 7) to a message in the channel
   */
  async sendReaction(
    conversation: Conversation,
    messageId: string,
    emoji: string,
    customEmoji?: { shortcode: string; url: string },
  ): Promise<void> {
    const activeSigner = accountManager.active$.value?.signer;
    if (!activeSigner) {
      throw new Error("No active signer");
    }

    const channelEvent = conversation.metadata?.channelEvent;
    if (!channelEvent) {
      throw new Error("Channel event not found");
    }

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["e", messageId], // Event being reacted to
      ["k", "42"], // Kind of event being reacted to
    ];

    // Add NIP-30 custom emoji tag if provided
    if (customEmoji) {
      tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
    }

    const draft = await factory.build({ kind: 7, content: emoji, tags });
    const event = await factory.sign(draft);

    await publishEvent(event);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false, // kind 42 messages are public
      supportsThreading: true, // NIP-10 marked e-tags
      supportsModeration: true, // kind 43/44 client-side
      supportsRoles: false, // No roles in NIP-28
      supportsGroupManagement: false, // Open participation
      canCreateConversations: true, // Users can create channels (kind 40)
      requiresRelay: false, // Multi-relay coordination
    };
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
    const cachedEvent = await firstValueFrom(eventStore.event(eventId), {
      defaultValue: undefined,
    });
    if (cachedEvent) {
      return cachedEvent;
    }

    // Not in store, fetch from channel relays
    const relays = conversation.metadata?.relayUrl?.split(",") || [];
    if (relays.length === 0) {
      console.warn("[NIP-28] No relays available for loading reply message");
      return null;
    }

    console.log(
      `[NIP-28] Fetching reply message ${eventId.slice(0, 8)}... from ${relays.length} relays`,
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
  private eventToMessage(
    event: NostrEvent,
    conversationId: string,
    channelId: string,
  ): Message {
    // Parse NIP-10 references to find reply target
    const references = getNip10References(event);
    let replyTo: string | undefined;

    // Look for reply marker (should point to parent message, not root channel)
    if (references.reply?.e) {
      const replyEventId = references.reply.e.id;
      // Only set replyTo if it's not the channel itself
      if (replyEventId !== channelId) {
        replyTo = replyEventId;
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
      protocol: "nip-28",
      metadata: {
        encrypted: false,
      },
      event,
    };
  }
}
