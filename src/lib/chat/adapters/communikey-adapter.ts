import { Observable, firstValueFrom } from "rxjs";
import { map, first, toArray } from "rxjs/operators";
import type { Filter } from "nostr-tools";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
  Participant,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import type { ChatAction, GetActionsOptions } from "@/types/chat-actions";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEventToRelays, publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";
import { getTagValues } from "@/lib/nostr-utils";
import { normalizeRelayURL } from "@/lib/relay-url";
import { EventFactory } from "applesauce-core/event-factory";

/**
 * Communikey Adapter - NIP-29 fallback using kind 10222 communities
 *
 * Features:
 * - Fallback when NIP-29 group ID is a valid pubkey with kind 10222 definition
 * - Community pubkey acts as admin
 * - Members derived from chat participants (unique message authors)
 * - Multi-relay support (main + backups from r-tags)
 * - Client-side moderation only
 *
 * Identifier format: pubkey (hex) with relays from kind 10222
 * Events use "h" tag with community pubkey (same as NIP-29)
 */
export class CommunikeyAdapter extends ChatProtocolAdapter {
  readonly protocol = "communikey" as const;
  readonly type = "group" as const;

  /**
   * Parse identifier - only accepts valid hex pubkeys
   * Relay list comes from kind 10222, not the identifier
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Check if input is a valid 64-character hex pubkey
    if (!/^[0-9a-f]{64}$/i.test(input)) {
      return null;
    }

    // Return minimal identifier - relays will be fetched from kind 10222
    return {
      type: "communikey",
      value: input.toLowerCase(),
      relays: [],
    };
  }

  /**
   * Resolve conversation from communikey identifier
   * Fetches kind 10222 (community definition) and kind 0 (profile)
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    // This adapter only handles communikey identifiers
    if (identifier.type !== "communikey") {
      throw new Error(
        `Communikey adapter cannot handle identifier type: ${identifier.type}`,
      );
    }
    const communikeyPubkey = identifier.value;

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    console.log(
      `[Communikey] Fetching community definition for ${communikeyPubkey.slice(0, 8)}...`,
    );

    // Fetch kind 10222 (community definition)
    const definitionFilter: Filter = {
      kinds: [10222],
      authors: [communikeyPubkey],
      limit: 1,
    };

    // Use user's outbox/general relays for fetching
    // TODO: Could use more sophisticated relay selection
    const fallbackRelays =
      identifier.relays.length > 0
        ? identifier.relays
        : Array.from(pool.relays.keys()).slice(0, 5);

    const definitionEvents = await firstValueFrom(
      pool
        .request(fallbackRelays, [definitionFilter], { eventStore })
        .pipe(toArray()),
    );

    const definitionEvent = definitionEvents[0];
    if (!definitionEvent) {
      throw new Error(
        `No community definition found for ${communikeyPubkey.slice(0, 8)}...`,
      );
    }

    console.log(
      `[Communikey] Found community definition, tags:`,
      definitionEvent.tags,
    );

    // Extract relays from r-tags
    const relays = getTagValues(definitionEvent, "r")
      .map((url) => {
        // Add wss:// prefix if not present
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
          return `wss://${url}`;
        }
        return url;
      })
      .filter((url) => url); // Remove empty strings

    if (relays.length === 0) {
      throw new Error("Community definition has no relay URLs (r-tags)");
    }

    console.log(`[Communikey] Community relays:`, relays);

    // Fetch kind 0 (profile) for community name/picture
    const profileFilter: Filter = {
      kinds: [0],
      authors: [communikeyPubkey],
      limit: 1,
    };

    const profileEvents = await firstValueFrom(
      pool.request(relays, [profileFilter], { eventStore }).pipe(toArray()),
    );

    const profileEvent = profileEvents[0];

    // Parse profile metadata
    let profileName = communikeyPubkey.slice(0, 8);
    let profilePicture: string | undefined;
    let profileAbout: string | undefined;

    if (profileEvent) {
      try {
        const metadata = JSON.parse(profileEvent.content);
        profileName = metadata.name || profileName;
        profilePicture = metadata.picture;
        profileAbout = metadata.about;
      } catch (err) {
        console.warn("[Communikey] Failed to parse profile metadata:", err);
      }
    }

    // Check for description override in kind 10222
    const descriptionOverride = getTagValues(definitionEvent, "description")[0];
    const description = descriptionOverride || profileAbout;

    console.log(`[Communikey] Community name: ${profileName}`);

    // Community pubkey is the admin
    const participants: Participant[] = [
      {
        pubkey: communikeyPubkey,
        role: "admin",
      },
    ];

    // Note: Additional members will be derived dynamically from message authors
    // We'll add them as we see messages in the loadMessages observable

    return {
      id: `communikey:${communikeyPubkey}`,
      type: "group",
      protocol: "communikey",
      title: profileName,
      participants,
      metadata: {
        communikeyPubkey,
        communikeyDefinition: definitionEvent,
        communikeyRelays: relays,
        ...(description && { description }),
        ...(profilePicture && { icon: profilePicture }),
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a communikey group
   * Uses same kind 9 format as NIP-29 with #h tag
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const communikeyPubkey = conversation.metadata?.communikeyPubkey;
    const relays = conversation.metadata?.communikeyRelays;

    if (!communikeyPubkey || !relays || relays.length === 0) {
      throw new Error("Community pubkey and relays required");
    }

    console.log(
      `[Communikey] Loading messages for ${communikeyPubkey.slice(0, 8)}... from ${relays.length} relays`,
    );

    // Filter for chat messages (kind 9) and nutzaps (kind 9321)
    // Same as NIP-29 but without system events (no relay-enforced moderation)
    const filter: Filter = {
      kinds: [9, 9321],
      "#h": [communikeyPubkey],
      limit: options?.limit || 50,
    };

    if (options?.before) {
      filter.until = options.before;
    }
    if (options?.after) {
      filter.since = options.after;
    }

    // Clean up any existing subscription for this conversation
    const conversationId = `communikey:${communikeyPubkey}`;
    this.cleanup(conversationId);

    // Start a persistent subscription to all community relays
    const subscription = pool
      .subscription(relays, [filter], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[Communikey] EOSE received");
          } else {
            console.log(
              `[Communikey] Received event k${response.kind}: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    // Store subscription for cleanup
    this.subscriptions.set(conversationId, subscription);

    // Return observable from EventStore which will update automatically
    return eventStore.timeline(filter).pipe(
      map((events) => {
        const messages = events.map((event) => {
          // Convert nutzaps (kind 9321) using nutzapToMessage
          if (event.kind === 9321) {
            return this.nutzapToMessage(event, conversation.id);
          }
          // All other events use eventToMessage
          return this.eventToMessage(event, conversation.id);
        });

        console.log(`[Communikey] Timeline has ${messages.length} events`);
        // EventStore timeline returns events sorted by created_at desc,
        // we need ascending order for chat. Since it's already sorted,
        // just reverse instead of full sort (O(n) vs O(n log n))
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
    const communikeyPubkey = conversation.metadata?.communikeyPubkey;
    const relays = conversation.metadata?.communikeyRelays;

    if (!communikeyPubkey || !relays || relays.length === 0) {
      throw new Error("Community pubkey and relays required");
    }

    console.log(
      `[Communikey] Loading older messages for ${communikeyPubkey.slice(0, 8)}... before ${before}`,
    );

    // Same filter as loadMessages but with until for pagination
    const filter: Filter = {
      kinds: [9, 9321],
      "#h": [communikeyPubkey],
      until: before,
      limit: 50,
    };

    // One-shot request to fetch older messages
    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    console.log(`[Communikey] Loaded ${events.length} older events`);

    // Convert events to messages
    const messages = events.map((event) => {
      if (event.kind === 9321) {
        return this.nutzapToMessage(event, conversation.id);
      }
      return this.eventToMessage(event, conversation.id);
    });

    // loadMoreMessages returns events in desc order from relay,
    // reverse for ascending chronological order
    return messages.reverse();
  }

  /**
   * Send a message to the communikey group
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

    const communikeyPubkey = conversation.metadata?.communikeyPubkey;
    const relays = conversation.metadata?.communikeyRelays;

    if (!communikeyPubkey || !relays || relays.length === 0) {
      throw new Error("Community pubkey and relays required");
    }

    // Create event factory and sign event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [["h", communikeyPubkey]];

    if (options?.replyTo) {
      // Use q-tag for replies (same as NIP-29/NIP-C7)
      tags.push(["q", options.replyTo]);
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

    // Use kind 9 for group chat messages
    const draft = await factory.build({ kind: 9, content, tags });
    const event = await factory.sign(draft);

    // Publish to all community relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Send a reaction (kind 7) to a message in the communikey group
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

    const communikeyPubkey = conversation.metadata?.communikeyPubkey;
    const relays = conversation.metadata?.communikeyRelays;

    if (!communikeyPubkey || !relays || relays.length === 0) {
      throw new Error("Community pubkey and relays required");
    }

    // Create event factory and sign event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["e", messageId], // Event being reacted to
      ["h", communikeyPubkey], // Communikey context
      ["k", "9"], // Kind of event being reacted to (chat message)
    ];

    // Add NIP-30 custom emoji tag if provided
    if (customEmoji) {
      tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
    }

    // Use kind 7 for reactions
    const draft = await factory.build({ kind: 7, content: emoji, tags });
    const event = await factory.sign(draft);

    // Publish to all community relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false, // kind 9 messages are public
      supportsThreading: true, // q-tag replies
      supportsModeration: false, // Client-side only, no relay enforcement
      supportsRoles: true, // Admin role for community pubkey
      supportsGroupManagement: false, // No join/leave - open participation
      canCreateConversations: false, // Communities created via kind 10222
      requiresRelay: true, // Multi-relay (main + backups)
    };
  }

  /**
   * Get available actions for Communikey groups
   * Currently only bookmark/unbookmark (no join/leave - open participation)
   */
  getActions(_options?: GetActionsOptions): ChatAction[] {
    const actions: ChatAction[] = [];

    // Bookmark/unbookmark actions (same as NIP-29)
    actions.push({
      name: "bookmark",
      description: "Add community to your group list",
      handler: async (context) => {
        try {
          await this.bookmarkCommunity(
            context.conversation,
            context.activePubkey,
          );
          return {
            success: true,
            message: "Community added to your list",
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to bookmark community",
          };
        }
      },
    });

    actions.push({
      name: "unbookmark",
      description: "Remove community from your group list",
      handler: async (context) => {
        try {
          await this.unbookmarkCommunity(
            context.conversation,
            context.activePubkey,
          );
          return {
            success: true,
            message: "Community removed from your list",
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to unbookmark community",
          };
        }
      },
    });

    return actions;
  }

  /**
   * Load a replied-to message
   * First checks EventStore, then fetches from community relays if needed
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

    // Not in store, fetch from community relays
    const relays = conversation.metadata?.communikeyRelays;
    if (!relays || relays.length === 0) {
      console.warn("[Communikey] No relays for loading reply message");
      return null;
    }

    console.log(
      `[Communikey] Fetching reply message ${eventId.slice(0, 8)}... from ${relays.length} relays`,
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
          `[Communikey] Reply message fetch timeout for ${eventId.slice(0, 8)}...`,
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
          console.error(`[Communikey] Reply message fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Add a communikey to the user's group list (kind 10009)
   * Uses same format as NIP-29 bookmark but with communikey pubkey
   */
  async bookmarkCommunity(
    conversation: Conversation,
    activePubkey: string,
  ): Promise<void> {
    const activeSigner = accountManager.active$.value?.signer;

    if (!activeSigner) {
      throw new Error("No active signer");
    }

    const communikeyPubkey = conversation.metadata?.communikeyPubkey;
    const relays = conversation.metadata?.communikeyRelays;

    if (!communikeyPubkey || !relays || relays.length === 0) {
      throw new Error("Community pubkey and relays required");
    }

    // Use first relay as primary
    const primaryRelay = relays[0];
    const normalizedRelayUrl = normalizeRelayURL(primaryRelay);

    // Fetch current kind 10009 event (group list)
    const currentEvent = await firstValueFrom(
      eventStore.replaceable(10009, activePubkey, ""),
      { defaultValue: undefined },
    );

    // Build new tags array
    let tags: string[][] = [];

    if (currentEvent) {
      // Copy existing tags
      tags = [...currentEvent.tags];

      // Check if communikey is already in the list
      const existingGroup = tags.find(
        (t) =>
          t[0] === "group" &&
          t[1] === communikeyPubkey &&
          normalizeRelayURL(t[2] || "") === normalizedRelayUrl,
      );

      if (existingGroup) {
        throw new Error("Community is already in your list");
      }
    }

    // Add the new group tag (use communikey pubkey as group ID)
    tags.push(["group", communikeyPubkey, normalizedRelayUrl]);

    // Create and publish the updated event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const draft = await factory.build({
      kind: 10009,
      content: "",
      tags,
    });
    const event = await factory.sign(draft);
    await publishEvent(event);
  }

  /**
   * Remove a communikey from the user's group list (kind 10009)
   */
  async unbookmarkCommunity(
    conversation: Conversation,
    activePubkey: string,
  ): Promise<void> {
    const activeSigner = accountManager.active$.value?.signer;

    if (!activeSigner) {
      throw new Error("No active signer");
    }

    const communikeyPubkey = conversation.metadata?.communikeyPubkey;
    const relays = conversation.metadata?.communikeyRelays;

    if (!communikeyPubkey || !relays || relays.length === 0) {
      throw new Error("Community pubkey and relays required");
    }

    // Use first relay as primary
    const primaryRelay = relays[0];
    const normalizedRelayUrl = normalizeRelayURL(primaryRelay);

    // Fetch current kind 10009 event (group list)
    const currentEvent = await firstValueFrom(
      eventStore.replaceable(10009, activePubkey, ""),
      { defaultValue: undefined },
    );

    if (!currentEvent) {
      throw new Error("No group list found");
    }

    // Find and remove the communikey tag
    const originalLength = currentEvent.tags.length;
    const tags = currentEvent.tags.filter(
      (t) =>
        !(
          t[0] === "group" &&
          t[1] === communikeyPubkey &&
          normalizeRelayURL(t[2] || "") === normalizedRelayUrl
        ),
    );

    if (tags.length === originalLength) {
      throw new Error("Community is not in your list");
    }

    // Create and publish the updated event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const draft = await factory.build({
      kind: 10009,
      content: "",
      tags,
    });
    const event = await factory.sign(draft);
    await publishEvent(event);
  }

  /**
   * Helper: Convert Nostr event to Message
   */
  private eventToMessage(event: NostrEvent, conversationId: string): Message {
    // Look for reply q-tags
    const qTags = getTagValues(event, "q");
    const replyTo = qTags[0]; // First q-tag is the reply target

    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo,
      protocol: "communikey",
      metadata: {
        encrypted: false, // kind 9 messages are always public
      },
      event,
    };
  }

  /**
   * Helper: Convert nutzap event (kind 9321) to Message
   * NIP-61 nutzaps are P2PK-locked Cashu token transfers
   */
  private nutzapToMessage(event: NostrEvent, conversationId: string): Message {
    // Sender is the event author
    const sender = event.pubkey;

    // Recipient is the p-tag value
    const pTag = event.tags.find((t) => t[0] === "p");
    const recipient = pTag?.[1] || "";

    // Reply target is the e-tag (the event being nutzapped)
    const eTag = event.tags.find((t) => t[0] === "e");
    const replyTo = eTag?.[1];

    // Amount is sum of proof amounts from all proof tags
    let amount = 0;
    for (const tag of event.tags) {
      if (tag[0] === "proof" && tag[1]) {
        try {
          const proof = JSON.parse(tag[1]);
          // Proof can be a single object or an array of proofs
          if (Array.isArray(proof)) {
            amount += proof.reduce(
              (sum: number, p: { amount?: number }) => sum + (p.amount || 0),
              0,
            );
          } else if (typeof proof === "object" && proof.amount) {
            amount += proof.amount;
          }
        } catch {
          // Invalid proof JSON, skip this tag
        }
      }
    }

    // Unit defaults to "sat" per NIP-61
    const unitTag = event.tags.find((t) => t[0] === "unit");
    const unit = unitTag?.[1] || "sat";

    // Comment is in the content field
    const comment = event.content || "";

    return {
      id: event.id,
      conversationId,
      author: sender,
      content: comment,
      timestamp: event.created_at,
      type: "zap", // Render the same as zaps
      replyTo,
      protocol: "communikey",
      metadata: {
        encrypted: false,
        zapAmount: amount, // In the unit specified (usually sats)
        zapRecipient: recipient,
        nutzapUnit: unit, // Store unit for potential future use
      },
      event,
    };
  }
}
