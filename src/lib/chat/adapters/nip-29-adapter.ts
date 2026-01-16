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
import { publishEventToRelays, publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";
import { getTagValues } from "@/lib/nostr-utils";
import { normalizeRelayURL } from "@/lib/relay-url";
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
   * Parse identifier - accepts group ID format, naddr, or communikey format
   * Examples:
   *   - wss://relay.example.com'bitcoin-dev (NIP-29)
   *   - relay.example.com'bitcoin-dev (NIP-29, wss:// prefix is optional)
   *   - naddr1... (kind 39000 group metadata address, NIP-29)
   *   - relay.example.com'npub1xxx (NIP-CC communikey)
   *   - npub1xxx (NIP-CC communikey, relays from kind 10222)
   *   - hex-pubkey (NIP-CC communikey, relays from kind 10222)
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

    // NIP-29/NIP-CC format: [wss://]relay'group-id-or-pubkey
    const match = input.match(/^((?:wss?:\/\/)?[^']+)'([^']+)$/);
    if (match) {
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

    // NIP-CC bare communikey format: npub1xxx or hex pubkey
    // Check if input is a valid pubkey (relays will be fetched from kind 10222)
    const pubkey = this.extractPubkey(input);
    if (pubkey) {
      return {
        type: "group",
        value: pubkey,
        relays: [], // Will be resolved from kind 10222
      };
    }

    return null;
  }

  /**
   * Resolve conversation from group identifier
   * Supports both traditional NIP-29 groups and NIP-CC communikeys
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

    // Check if this is a communikey (NIP-CC) by checking if groupId is a pubkey
    const pubkey = this.extractPubkey(groupId);
    if (pubkey) {
      console.log(
        `[NIP-29] Detected communikey format: ${pubkey.slice(0, 16)}...`,
      );
      return this.resolveCommunikeyConversation(identifier, pubkey);
    }

    // Traditional NIP-29 group
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
   * Load messages for a group (supports both NIP-29 and NIP-CC)
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const groupId = conversation.metadata?.groupId;
    const communikeyConfig = conversation.metadata?.communikeyConfig;

    if (!groupId) {
      throw new Error("Group ID required");
    }

    // Determine relays to use:
    // - NIP-CC: Use main + backup relays from communikey config
    // - NIP-29: Use single relay from metadata
    const relays: string[] = communikeyConfig
      ? [communikeyConfig.mainRelay, ...communikeyConfig.backupRelays]
      : conversation.metadata?.relayUrl
        ? [conversation.metadata.relayUrl]
        : [];

    if (relays.length === 0) {
      throw new Error("No relays available for group");
    }

    const protocol = communikeyConfig ? "NIP-CC" : "NIP-29";
    console.log(
      `[${protocol}] Loading messages for ${groupId.slice(0, 16)}... from ${relays.length} relay(s)`,
    );

    // Single filter for all group events:
    // kind 9: chat messages
    // kind 9000: put-user (admin adds user)
    // kind 9001: remove-user (admin removes user)
    // kind 9321: nutzaps (NIP-61)
    const filter: Filter = {
      kinds: [9, 9000, 9001, 9321],
      "#h": [groupId], // Both NIP-29 and NIP-CC use h tag!
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

    // Start a persistent subscription to the group relay(s)
    const subscription = pool
      .subscription(relays, [filter], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log(`[${protocol}] EOSE received`);
          } else {
            console.log(
              `[${protocol}] Received event k${response.kind}: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    // Store subscription for cleanup
    this.subscriptions.set(conversation.id, subscription);

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
   * Load more historical messages (pagination, supports both NIP-29 and NIP-CC)
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const groupId = conversation.metadata?.groupId;
    const communikeyConfig = conversation.metadata?.communikeyConfig;

    if (!groupId) {
      throw new Error("Group ID required");
    }

    // Determine relays to use
    const relays: string[] = communikeyConfig
      ? [communikeyConfig.mainRelay, ...communikeyConfig.backupRelays]
      : conversation.metadata?.relayUrl
        ? [conversation.metadata.relayUrl]
        : [];

    if (relays.length === 0) {
      throw new Error("No relays available for group");
    }

    const protocol = communikeyConfig ? "NIP-CC" : "NIP-29";
    console.log(
      `[${protocol}] Loading older messages for ${groupId.slice(0, 16)}... before ${before}`,
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
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    console.log(`[${protocol}] Loaded ${events.length} older events`);

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
   * Send a message to the group (supports both NIP-29 and NIP-CC)
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
    const communikeyConfig = conversation.metadata?.communikeyConfig;

    if (!groupId) {
      throw new Error("Group ID required");
    }

    // Determine relays to use
    const relays: string[] = communikeyConfig
      ? [communikeyConfig.mainRelay, ...communikeyConfig.backupRelays]
      : conversation.metadata?.relayUrl
        ? [conversation.metadata.relayUrl]
        : [];

    if (relays.length === 0) {
      throw new Error("No relays available for group");
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

    // Add NIP-92 imeta tags for blob attachments
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);

        // NIP-CC: Add blossom server hints from communikey config
        if (communikeyConfig && communikeyConfig.blossomServers.length > 0) {
          // Use first blossom server as hint (can be extended to use all)
          const blossomServer = communikeyConfig.blossomServers[0];
          if (!blob.server) {
            imetaParts.push(`server ${blossomServer}`);
          }
        }

        tags.push(["imeta", ...imetaParts]);
      }
    }

    // Use kind 9 for group chat messages
    const draft = await factory.build({ kind: 9, content, tags });
    const event = await factory.sign(draft);

    // Publish to group relay(s)
    await publishEventToRelays(event, relays);
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
   * - /bookmark: only shown when group is NOT in user's kind 10009 list
   * - /unbookmark: only shown when group IS in user's kind 10009 list
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

    // Add bookmark/unbookmark actions
    // These are always available - the handler checks current state
    actions.push({
      name: "bookmark",
      description: "Add group to your group list",
      handler: async (context) => {
        try {
          await this.bookmarkGroup(context.conversation, context.activePubkey);
          return {
            success: true,
            message: "Group added to your list",
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to bookmark group",
          };
        }
      },
    });

    actions.push({
      name: "unbookmark",
      description: "Remove group from your group list",
      handler: async (context) => {
        try {
          await this.unbookmarkGroup(
            context.conversation,
            context.activePubkey,
          );
          return {
            success: true,
            message: "Group removed from your list",
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Failed to unbookmark group",
          };
        }
      },
    });

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
      {
        name: "bookmark",
        description: "Add group to your group list",
        handler: async (context) => {
          try {
            await this.bookmarkGroup(
              context.conversation,
              context.activePubkey,
            );
            return {
              success: true,
              message: "Group added to your list",
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to bookmark group",
            };
          }
        },
      },
      {
        name: "unbookmark",
        description: "Remove group from your group list",
        handler: async (context) => {
          try {
            await this.unbookmarkGroup(
              context.conversation,
              context.activePubkey,
            );
            return {
              success: true,
              message: "Group removed from your list",
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to unbookmark group",
            };
          }
        },
      },
    ];
  }

  /**
   * Load a replied-to message (supports both NIP-29 and NIP-CC)
   * First checks EventStore, then fetches from group relay(s) if needed
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

    // Not in store, fetch from group relay(s)
    const communikeyConfig = conversation.metadata?.communikeyConfig;
    const relays: string[] = communikeyConfig
      ? [communikeyConfig.mainRelay, ...communikeyConfig.backupRelays]
      : conversation.metadata?.relayUrl
        ? [conversation.metadata.relayUrl]
        : [];

    if (relays.length === 0) {
      console.warn(
        `[${communikeyConfig ? "NIP-CC" : "NIP-29"}] No relays for loading reply message`,
      );
      return null;
    }

    const protocol = communikeyConfig ? "NIP-CC" : "NIP-29";
    console.log(
      `[${protocol}] Fetching reply message ${eventId.slice(0, 8)}... from ${relays.length} relay(s)`,
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
          `[${protocol}] Reply message fetch timeout for ${eventId.slice(0, 8)}...`,
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
          console.error(`[${protocol}] Reply message fetch error:`, err);
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
   * Helper: Check if a tag matches a group by ID and relay URL (normalized comparison)
   */
  private isMatchingGroupTag(
    tag: string[],
    groupId: string,
    normalizedRelayUrl: string,
  ): boolean {
    if (tag[0] !== "group" || tag[1] !== groupId) {
      return false;
    }
    // Normalize the tag's relay URL for comparison
    try {
      const tagRelayUrl = tag[2];
      if (!tagRelayUrl) return false;
      return normalizeRelayURL(tagRelayUrl) === normalizedRelayUrl;
    } catch {
      // If normalization fails, try exact match as fallback
      return tag[2] === normalizedRelayUrl;
    }
  }

  /**
   * Add a group to the user's group list (kind 10009)
   */
  async bookmarkGroup(
    conversation: Conversation,
    activePubkey: string,
  ): Promise<void> {
    const activeSigner = accountManager.active$.value?.signer;

    if (!activeSigner) {
      throw new Error("No active signer");
    }

    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    // Normalize the relay URL for comparison
    const normalizedRelayUrl = normalizeRelayURL(relayUrl);

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

      // Check if group is already in the list (using normalized URL comparison)
      const existingGroup = tags.find((t) =>
        this.isMatchingGroupTag(t, groupId, normalizedRelayUrl),
      );

      if (existingGroup) {
        throw new Error("Group is already in your list");
      }
    }

    // Add the new group tag (use normalized URL for consistency)
    tags.push(["group", groupId, normalizedRelayUrl]);

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
   * Remove a group from the user's group list (kind 10009)
   */
  async unbookmarkGroup(
    conversation: Conversation,
    activePubkey: string,
  ): Promise<void> {
    const activeSigner = accountManager.active$.value?.signer;

    if (!activeSigner) {
      throw new Error("No active signer");
    }

    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    // Normalize the relay URL for comparison
    const normalizedRelayUrl = normalizeRelayURL(relayUrl);

    // Fetch current kind 10009 event (group list)
    const currentEvent = await firstValueFrom(
      eventStore.replaceable(10009, activePubkey, ""),
      { defaultValue: undefined },
    );

    if (!currentEvent) {
      throw new Error("No group list found");
    }

    // Find and remove the group tag (using normalized URL comparison)
    const originalLength = currentEvent.tags.length;
    const tags = currentEvent.tags.filter(
      (t) => !this.isMatchingGroupTag(t, groupId, normalizedRelayUrl),
    );

    if (tags.length === originalLength) {
      throw new Error("Group is not in your list");
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

  /**
   * NIP-CC Communikey Support
   * -------------------------
   * Communikeys use pubkeys as community identifiers with metadata from kind 10222
   */

  /**
   * Extract pubkey from various formats (npub, hex, or string)
   * Returns hex pubkey if valid, null otherwise
   */
  private extractPubkey(input: string): string | null {
    // Try npub decode
    if (input.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          return decoded.data;
        }
      } catch {
        return null;
      }
    }

    // Try hex pubkey (64 chars, valid hex)
    if (/^[0-9a-f]{64}$/i.test(input)) {
      return input.toLowerCase();
    }

    return null;
  }

  /**
   * Resolve a communikey conversation (NIP-CC)
   * Fetches kind 10222 for config and kind 0 for display metadata
   */
  private async resolveCommunikeyConversation(
    identifier: ProtocolIdentifier,
    pubkey: string,
  ): Promise<Conversation> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    console.log(
      `[NIP-CC] Fetching communikey metadata for ${pubkey.slice(0, 16)}...`,
    );

    // Step 1: Fetch kind 10222 communikey definition event
    const communikeyEvent = await this.fetchCommunikeyEvent(
      pubkey,
      identifier.relays,
    );

    if (!communikeyEvent) {
      throw new Error(
        "Communikey event (kind 10222) not found. This pubkey may not be a valid communikey.",
      );
    }

    // Step 2: Parse communikey configuration
    const config = this.parseCommunikeyEvent(communikeyEvent);
    console.log(`[NIP-CC] Main relay: ${config.mainRelay}`);
    console.log(`[NIP-CC] Backup relays: ${config.backupRelays.length}`);
    console.log(`[NIP-CC] Blossom servers: ${config.blossomServers.length}`);

    // Step 3: Fetch profile (kind 0) for display info
    const profile = await this.fetchProfile(pubkey, [
      config.mainRelay,
      ...config.backupRelays,
    ]);

    // Step 4: Fetch recent messages to derive participants
    const recentParticipants = await this.fetchCommunikeyParticipants(pubkey, [
      config.mainRelay,
      ...config.backupRelays,
    ]);

    // Step 5: Build participants list (host + actual members)
    const participants = this.buildCommunikeyParticipants(
      pubkey,
      config,
      recentParticipants,
    );

    // Step 6: Build conversation
    const title =
      profile?.display_name ||
      profile?.name ||
      `Communikey ${pubkey.slice(0, 8)}`;
    const description = config.description || profile?.about || undefined;
    const icon = profile?.picture || undefined;

    return {
      id: `nip-cc:${pubkey}`,
      type: "group",
      protocol: "communikeys", // NIP-CC protocol (uses kind 9 format)
      title,
      participants,
      metadata: {
        groupId: pubkey, // Use pubkey as group ID
        relayUrl: config.mainRelay,
        description,
        icon,
        // Store full config for later use
        communikeyConfig: config,
      },
      unreadCount: 0,
    };
  }

  /**
   * Fetch kind 10222 communikey event
   * Tries hint relays first, then falls back to user's outbox relays
   */
  private async fetchCommunikeyEvent(
    pubkey: string,
    hintRelays?: string[],
  ): Promise<NostrEvent | null> {
    // Build relay list: hint relays + outbox relays
    const outboxRelays = await this.getOutboxRelays(pubkey);
    const relays = [...(hintRelays || []), ...outboxRelays].filter(Boolean);

    if (relays.length === 0) {
      // Fallback to some popular relays if no hints
      relays.push(
        "wss://relay.damus.io",
        "wss://relay.primal.net",
        "wss://nos.lol",
      );
    }

    console.log(`[NIP-CC] Searching ${relays.length} relays for kind 10222`);

    const filter: Filter = {
      kinds: [10222],
      authors: [pubkey],
      limit: 1,
    };

    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    return events[0] || null;
  }

  /**
   * Parse kind 10222 communikey event into configuration
   */
  private parseCommunikeyEvent(event: NostrEvent): CommunikeyConfig {
    const config: CommunikeyConfig = {
      mainRelay: "",
      backupRelays: [],
      blossomServers: [],
      mints: [],
      roles: {},
      contentSections: [],
      description: undefined,
    };

    let currentSection: ContentSection | null = null;

    for (const tag of event.tags) {
      switch (tag[0]) {
        case "r":
          // First r tag is main relay, rest are backups
          if (!config.mainRelay) {
            config.mainRelay = tag[1];
          } else {
            config.backupRelays.push(tag[1]);
          }
          break;

        case "blossom":
          if (tag[1]) config.blossomServers.push(tag[1]);
          break;

        case "mint":
          if (tag[1]) config.mints.push(tag[1]);
          break;

        case "content":
          // Start a new content section
          if (currentSection) {
            config.contentSections.push(currentSection);
          }
          currentSection = {
            name: tag[1],
            kinds: [],
            roles: [],
            fee: undefined,
            exclusive: false,
          };
          break;

        case "k":
          // Add kind to current section
          if (currentSection && tag[1]) {
            const kind = parseInt(tag[1], 10);
            if (!isNaN(kind)) {
              currentSection.kinds.push(kind);
            }
          }
          break;

        case "role":
          // Add role restriction to current section
          if (currentSection) {
            // Format: ["role", "admin", "team", ...]
            currentSection.roles.push(...tag.slice(1));
          } else {
            // Global role (applies to user)
            // Format: ["role", "<pubkey>", "<role>"]
            if (tag[1] && tag[2]) {
              config.roles[tag[1]] = tag[2] as ParticipantRole;
            }
          }
          break;

        case "fee":
          // Fee for current section
          if (currentSection && tag[1] && tag[2]) {
            currentSection.fee = {
              amount: parseInt(tag[1], 10),
              unit: tag[2],
            };
          }
          break;

        case "exclusive":
          if (currentSection) {
            currentSection.exclusive = tag[1] === "true";
          }
          break;

        case "description":
          if (tag[1]) config.description = tag[1];
          break;
      }
    }

    // Don't forget the last section
    if (currentSection) {
      config.contentSections.push(currentSection);
    }

    // Validate: must have at least a main relay
    if (!config.mainRelay) {
      throw new Error("Communikey event missing main relay (r tag)");
    }

    return config;
  }

  /**
   * Fetch kind 0 profile metadata
   */
  private async fetchProfile(
    pubkey: string,
    relays: string[],
  ): Promise<any | null> {
    const filter: Filter = {
      kinds: [0],
      authors: [pubkey],
      limit: 1,
    };

    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    if (events[0]?.content) {
      try {
        return JSON.parse(events[0].content);
      } catch {
        console.warn("[NIP-CC] Failed to parse profile JSON");
        return null;
      }
    }
    return null;
  }

  /**
   * Get user's outbox relays from kind 10002 (NIP-65)
   */
  private async getOutboxRelays(pubkey: string): Promise<string[]> {
    // Fetch kind 10002 relay list
    const relayListEvent = await firstValueFrom(
      eventStore.replaceable(10002, pubkey, ""),
      { defaultValue: undefined },
    );

    if (!relayListEvent) {
      return [];
    }

    // Extract relays with "write" or no marker (default is read+write)
    const relays: string[] = [];
    for (const tag of relayListEvent.tags) {
      if (tag[0] === "r") {
        const url = tag[1];
        const marker = tag[2];
        // Include if no marker (read+write) or marker is "write"
        if (!marker || marker === "write") {
          relays.push(url);
        }
      }
    }

    return relays;
  }

  /**
   * Fetch recent chat participants for communikey
   * Returns unique pubkeys of people who have sent messages
   */
  private async fetchCommunikeyParticipants(
    communikeyPubkey: string,
    relays: string[],
  ): Promise<Set<string>> {
    console.log(
      `[NIP-CC] Fetching recent participants for ${communikeyPubkey.slice(0, 16)}...`,
    );

    // Fetch recent kind 9 messages to find active participants
    const filter: Filter = {
      kinds: [9],
      "#h": [communikeyPubkey],
      limit: 100, // Sample recent messages to find participants
    };

    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    // Extract unique authors (excluding the communikey itself)
    const participants = new Set<string>();
    for (const event of events) {
      if (event.pubkey !== communikeyPubkey) {
        participants.add(event.pubkey);
      }
    }

    console.log(`[NIP-CC] Found ${participants.size} active participants`);
    return participants;
  }

  /**
   * Build participants list for communikey
   * - Communikey pubkey is always the host
   * - Recent message senders are members
   * - Role-based participants from config are added with their roles
   */
  private buildCommunikeyParticipants(
    communikeyPubkey: string,
    config: CommunikeyConfig,
    recentParticipants: Set<string>,
  ): Participant[] {
    const participants: Participant[] = [];

    // 1. Communikey pubkey is the host
    participants.push({
      pubkey: communikeyPubkey,
      role: "host",
    });

    // 2. Add role-based participants from config (admins, moderators, etc.)
    for (const [pubkey, role] of Object.entries(config.roles)) {
      // Skip if already added as host
      if (pubkey === communikeyPubkey) continue;

      participants.push({
        pubkey,
        role: role as ParticipantRole,
      });
    }

    // 3. Add recent chat participants as members (if not already added)
    const existingPubkeys = new Set(participants.map((p) => p.pubkey));
    for (const pubkey of recentParticipants) {
      if (!existingPubkeys.has(pubkey)) {
        participants.push({
          pubkey,
          role: "member",
        });
      }
    }

    return participants;
  }
}

/**
 * Communikey configuration parsed from kind 10222
 */
interface CommunikeyConfig {
  mainRelay: string;
  backupRelays: string[];
  blossomServers: string[];
  mints: string[];
  roles: Record<string, ParticipantRole>;
  contentSections: ContentSection[];
  description?: string;
}

/**
 * Content section in communikey (defines allowed kinds and rules)
 */
interface ContentSection {
  name: string;
  kinds: number[];
  roles: string[];
  fee?: { amount: number; unit: string };
  exclusive: boolean;
}
