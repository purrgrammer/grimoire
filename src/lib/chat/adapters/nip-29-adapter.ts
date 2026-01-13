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
  Participant,
  ParticipantRole,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import type { ChatAction, GetActionsOptions } from "@/types/chat-actions";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import { getTagValues } from "@/lib/nostr-utils";
import { EventFactory } from "applesauce-core/event-factory";

/**
 * NIP-29 Adapter - Relay-Based Groups
 *
 * Features:
 * - Relay-enforced group membership and moderation
 * - Admin, moderator, and member roles
 * - Single relay enforces all group rules
 * - Group chat messages (kind 9)
 *
 * Group ID format: wss://relay.url'group-id
 * Events use "h" tag with group-id
 */
export class Nip29Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-29" as const;
  readonly type = "group" as const;

  /**
   * Parse identifier - accepts group ID format or naddr
   * Examples:
   *   - wss://relay.example.com'bitcoin-dev
   *   - relay.example.com'bitcoin-dev (wss:// prefix is optional)
   *   - naddr1... (kind 39000 group metadata address)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try naddr format first (kind 39000 group metadata)
    if (input.startsWith("naddr1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "naddr" && decoded.data.kind === 39000) {
          const { identifier, relays } = decoded.data;
          const relayUrl = relays?.[0];

          if (!identifier || !relayUrl) {
            return null;
          }

          // Ensure relay URL has wss:// prefix
          let normalizedRelay = relayUrl;
          if (
            !normalizedRelay.startsWith("ws://") &&
            !normalizedRelay.startsWith("wss://")
          ) {
            normalizedRelay = `wss://${normalizedRelay}`;
          }

          return {
            type: "group",
            value: identifier,
            relays: [normalizedRelay],
          };
        }
      } catch {
        // Not a valid naddr, fall through to try other formats
      }
    }

    // NIP-29 format: [wss://]relay'group-id
    const match = input.match(/^((?:wss?:\/\/)?[^']+)'([^']+)$/);
    if (!match) return null;

    let [, relayUrl] = match;
    const groupId = match[2];

    // Add wss:// prefix if not present
    if (!relayUrl.startsWith("ws://") && !relayUrl.startsWith("wss://")) {
      relayUrl = `wss://${relayUrl}`;
    }

    return {
      type: "group",
      value: groupId,
      relays: [relayUrl],
    };
  }

  /**
   * Resolve conversation from group identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    // This adapter only handles group identifiers
    if (identifier.type !== "group") {
      throw new Error(
        `NIP-29 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }
    const groupId = identifier.value;
    const relayUrl = identifier.relays?.[0];

    if (!relayUrl) {
      throw new Error("NIP-29 groups require a relay URL");
    }

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    console.log(
      `[NIP-29] Fetching group metadata for ${groupId} from ${relayUrl}`,
    );

    // Fetch group metadata from the specific relay (kind 39000)
    const metadataFilter: Filter = {
      kinds: [39000],
      "#d": [groupId],
      limit: 1,
    };

    // Use pool.subscription to fetch from the relay
    const metadataEvents: NostrEvent[] = [];
    const metadataObs = pool.subscription([relayUrl], [metadataFilter], {
      eventStore, // Automatically add to store
    });

    // Subscribe and wait for EOSE
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-29] Metadata fetch timeout");
        resolve();
      }, 5000);

      const sub = metadataObs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE received
            clearTimeout(timeout);
            console.log(
              `[NIP-29] Got ${metadataEvents.length} metadata events`,
            );
            sub.unsubscribe();
            resolve();
          } else {
            // Event received
            metadataEvents.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-29] Metadata fetch error:", err);
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    const metadataEvent = metadataEvents[0];

    // Debug: Log metadata event tags
    if (metadataEvent) {
      console.log(`[NIP-29] Metadata event tags:`, metadataEvent.tags);
    }

    // Extract group info from metadata event
    const title = metadataEvent
      ? getTagValues(metadataEvent, "name")[0] || groupId
      : groupId;
    const description = metadataEvent
      ? getTagValues(metadataEvent, "about")[0]
      : undefined;
    const icon = metadataEvent
      ? getTagValues(metadataEvent, "picture")[0]
      : undefined;

    console.log(`[NIP-29] Group title: ${title}`);

    // Fetch admins (kind 39001) and members (kind 39002)
    // Both use d tag (addressable events signed by relay)
    const participantsFilter: Filter = {
      kinds: [39001, 39002],
      "#d": [groupId],
      limit: 10, // Should be 1 of each kind, but allow for duplicates
    };

    const participantEvents: NostrEvent[] = [];
    const participantsObs = pool.subscription(
      [relayUrl],
      [participantsFilter],
      {
        eventStore,
      },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-29] Participants fetch timeout");
        resolve();
      }, 5000);

      const sub = participantsObs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE received
            clearTimeout(timeout);
            console.log(
              `[NIP-29] Got ${participantEvents.length} participant events`,
            );
            sub.unsubscribe();
            resolve();
          } else {
            // Event received
            participantEvents.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-29] Participants fetch error:", err);
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    // Helper to validate and normalize role names
    const normalizeRole = (role: string | undefined): ParticipantRole => {
      if (!role) return "member";
      const lower = role.toLowerCase();
      if (lower === "admin") return "admin";
      if (lower === "moderator") return "moderator";
      if (lower === "host") return "host";
      // Default to member for unknown roles
      return "member";
    };

    // Extract participants from both admins and members events
    const participantsMap = new Map<string, Participant>();

    // Process kind:39001 (admins with roles)
    const adminEvents = participantEvents.filter((e) => e.kind === 39001);
    for (const event of adminEvents) {
      // Each p tag: ["p", "<pubkey>", "<role1>", "<role2>", ...]
      for (const tag of event.tags) {
        if (tag[0] === "p" && tag[1]) {
          const pubkey = tag[1];
          const roles = tag.slice(2).filter((r) => r); // Get all roles after pubkey
          const primaryRole = normalizeRole(roles[0]); // Use first role as primary
          participantsMap.set(pubkey, { pubkey, role: primaryRole });
        }
      }
    }

    // Process kind:39002 (members without roles)
    const memberEvents = participantEvents.filter((e) => e.kind === 39002);
    for (const event of memberEvents) {
      // Each p tag: ["p", "<pubkey>"]
      for (const tag of event.tags) {
        if (tag[0] === "p" && tag[1]) {
          const pubkey = tag[1];
          // Only add if not already in map (admins take precedence)
          if (!participantsMap.has(pubkey)) {
            participantsMap.set(pubkey, { pubkey, role: "member" });
          }
        }
      }
    }

    const participants = Array.from(participantsMap.values());

    console.log(
      `[NIP-29] Found ${participants.length} participants (${adminEvents.length} admin events, ${memberEvents.length} member events)`,
    );
    console.log(
      `[NIP-29] Metadata - title: ${title}, icon: ${icon}, description: ${description}`,
    );

    return {
      id: `nip-29:${relayUrl}'${groupId}`,
      type: "group",
      protocol: "nip-29",
      title,
      participants,
      metadata: {
        groupId,
        relayUrl,
        ...(description && { description }),
        ...(icon && { icon }),
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a group
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    console.log(`[NIP-29] Loading messages for ${groupId} from ${relayUrl}`);

    // Single filter for all group events:
    // kind 9: chat messages
    // kind 9000: put-user (admin adds user)
    // kind 9001: remove-user (admin removes user)
    // kind 9321: nutzaps (NIP-61)
    const filter: Filter = {
      kinds: [9, 9000, 9001, 9321],
      "#h": [groupId],
      limit: options?.limit || 50,
    };

    if (options?.before) {
      filter.until = options.before;
    }
    if (options?.after) {
      filter.since = options.after;
    }

    // Clean up any existing subscription for this conversation
    const conversationId = `nip-29:${relayUrl}'${groupId}`;
    this.cleanup(conversationId);

    // Start a persistent subscription to the group relay
    const subscription = pool
      .subscription([relayUrl], [filter], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[NIP-29] EOSE received");
          } else {
            console.log(
              `[NIP-29] Received event k${response.kind}: ${response.id.slice(0, 8)}...`,
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

        console.log(`[NIP-29] Timeline has ${messages.length} events`);
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
    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    console.log(
      `[NIP-29] Loading older messages for ${groupId} before ${before}`,
    );

    // Same filter as loadMessages but with until for pagination
    const filter: Filter = {
      kinds: [9, 9000, 9001, 9321],
      "#h": [groupId],
      until: before,
      limit: 50,
    };

    // One-shot request to fetch older messages
    const events = await firstValueFrom(
      pool.request([relayUrl], [filter], { eventStore }).pipe(toArray()),
    );

    console.log(`[NIP-29] Loaded ${events.length} older events`);

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
   * Send a message to the group
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

    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    // Create event factory and sign event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [["h", groupId]];

    if (options?.replyTo) {
      // NIP-29 uses q-tag for replies (same as NIP-C7)
      tags.push(["q", options.replyTo]);
    }

    // Add NIP-30 emoji tags
    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    // Use kind 9 for group chat messages
    const draft = await factory.build({ kind: 9, content, tags });
    const event = await factory.sign(draft);

    // Publish only to the group relay
    await publishEventToRelays(event, [relayUrl]);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false, // kind 9 messages are public
      supportsThreading: true, // q-tag replies (NIP-C7 style)
      supportsModeration: true, // kind 9005/9006 for delete/ban
      supportsRoles: true, // admin, moderator, member
      supportsGroupManagement: true, // join/leave via kind 9021
      canCreateConversations: false, // Groups created by admins (kind 9007)
      requiresRelay: true, // Single relay enforces rules
    };
  }

  /**
   * Get available actions for NIP-29 groups
   * Filters actions based on user's membership status:
   * - /join: only shown when user is NOT a member/admin
   * - /leave: only shown when user IS a member
   */
  getActions(options?: GetActionsOptions): ChatAction[] {
    const actions: ChatAction[] = [];

    // Check if we have context to filter actions
    if (!options?.conversation || !options?.activePubkey) {
      // No context - return all actions
      return this.getAllActions();
    }

    const { conversation, activePubkey } = options;

    // Find user's participant info
    const userParticipant = conversation.participants.find(
      (p) => p.pubkey === activePubkey,
    );

    const isMember = !!userParticipant;

    // Add /join if user is NOT a member
    if (!isMember) {
      actions.push({
        name: "join",
        description: "Request to join the group",
        handler: async (context) => {
          try {
            await this.joinConversation(context.conversation);
            return {
              success: true,
              message: "Join request sent",
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error ? error.message : "Failed to join group",
            };
          }
        },
      });
    }

    // Add /leave if user IS a member
    if (isMember) {
      actions.push({
        name: "leave",
        description: "Leave the group",
        handler: async (context) => {
          try {
            await this.leaveConversation(context.conversation);
            return {
              success: true,
              message: "You left the group",
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to leave group",
            };
          }
        },
      });
    }

    return actions;
  }

  /**
   * Get all possible actions (used when no context available)
   * @private
   */
  private getAllActions(): ChatAction[] {
    return [
      {
        name: "join",
        description: "Request to join the group",
        handler: async (context) => {
          try {
            await this.joinConversation(context.conversation);
            return {
              success: true,
              message: "Join request sent",
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error ? error.message : "Failed to join group",
            };
          }
        },
      },
      {
        name: "leave",
        description: "Leave the group",
        handler: async (context) => {
          try {
            await this.leaveConversation(context.conversation);
            return {
              success: true,
              message: "You left the group",
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to leave group",
            };
          }
        },
      },
    ];
  }

  /**
   * Load a replied-to message
   * First checks EventStore, then fetches from group relay if needed
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

    // Not in store, fetch from group relay
    const relayUrl = conversation.metadata?.relayUrl;
    if (!relayUrl) {
      console.warn("[NIP-29] No relay URL for loading reply message");
      return null;
    }

    console.log(
      `[NIP-29] Fetching reply message ${eventId.slice(0, 8)}... from ${relayUrl}`,
    );

    const filter: Filter = {
      ids: [eventId],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription([relayUrl], [filter], { eventStore });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(
          `[NIP-29] Reply message fetch timeout for ${eventId.slice(0, 8)}...`,
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
          console.error(`[NIP-29] Reply message fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Join an existing group
   */
  async joinConversation(conversation: Conversation): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    // Create join request (kind 9021)
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["h", groupId],
      ["relay", relayUrl],
    ];

    const draft = await factory.build({
      kind: 9021,
      content: "",
      tags,
    });
    const event = await factory.sign(draft);
    await publishEventToRelays(event, [relayUrl]);
  }

  /**
   * Leave a group
   */
  async leaveConversation(conversation: Conversation): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    // Create leave request (kind 9022)
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["h", groupId],
      ["relay", relayUrl],
    ];

    const draft = await factory.build({
      kind: 9022,
      content: "",
      tags,
    });
    const event = await factory.sign(draft);
    await publishEventToRelays(event, [relayUrl]);
  }

  /**
   * Helper: Convert Nostr event to Message
   */
  private eventToMessage(event: NostrEvent, conversationId: string): Message {
    // Handle admin events (join/leave) as system messages
    if (event.kind === 9000 || event.kind === 9001) {
      // Extract the affected user's pubkey from p-tag
      const pTags = event.tags.filter((t) => t[0] === "p");
      const affectedPubkey = pTags[0]?.[1] || event.pubkey; // Fall back to event author

      let content = "";
      if (event.kind === 9000) {
        // put-user: admin adds someone (show as joined)
        content = "joined";
      } else if (event.kind === 9001) {
        // remove-user: admin removes someone
        content = "left";
      }

      return {
        id: event.id,
        conversationId,
        author: affectedPubkey, // Show the user who joined/left
        content,
        timestamp: event.created_at,
        type: "system",
        protocol: "nip-29",
        metadata: {
          encrypted: false,
        },
        event,
      };
    }

    // Regular chat message (kind 9)
    // Look for reply q-tags (NIP-29 uses q-tags like NIP-C7)
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
      protocol: "nip-29",
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
    // NIP-61 allows multiple proof tags, each containing a JSON-encoded Cashu proof
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
      protocol: "nip-29",
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
