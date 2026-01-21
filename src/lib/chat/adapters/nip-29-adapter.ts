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
import {
  GroupMessageBlueprint,
  ReactionBlueprint,
} from "applesauce-common/blueprints";

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

    // Fetch admins (kind 39001) and members (kind 39002) in parallel
    // Both use d tag (addressable events signed by relay)
    const adminsFilter: Filter = {
      kinds: [39001],
      "#d": [groupId],
      limit: 1,
    };

    const membersFilter: Filter = {
      kinds: [39002],
      "#d": [groupId],
      limit: 1,
    };

    // Use pool.request with both filters to fetch and auto-close on EOSE
    const participantEvents = await firstValueFrom(
      pool
        .request([relayUrl], [adminsFilter, membersFilter], { eventStore })
        .pipe(toArray()),
    );

    console.log(`[NIP-29] Got ${participantEvents.length} participant events`);

    const adminEvents = participantEvents.filter((e) => e.kind === 39001);
    const memberEvents = participantEvents.filter((e) => e.kind === 39002);

    // Helper to validate and normalize role names
    const normalizeRole = (
      role: string | undefined,
      defaultRole: ParticipantRole,
    ): ParticipantRole => {
      if (!role) return defaultRole;
      const lower = role.toLowerCase();
      if (lower === "admin") return "admin";
      if (lower === "moderator") return "moderator";
      if (lower === "host") return "host";
      // Default to provided default for unknown roles
      return defaultRole;
    };

    // Extract participants from both admins and members events
    const participantsMap = new Map<string, Participant>();

    // Process kind:39001 (admins with roles)
    // Users in kind 39001 are admins by default
    for (const event of adminEvents) {
      // Each p tag: ["p", "<pubkey>", "<role1>", "<role2>", ...]
      for (const tag of event.tags) {
        if (tag[0] === "p" && tag[1]) {
          const pubkey = tag[1];
          const roles = tag.slice(2).filter((r) => r); // Get all roles after pubkey
          const primaryRole = normalizeRole(roles[0], "admin"); // Default to "admin" for kind 39001
          participantsMap.set(pubkey, { pubkey, role: primaryRole });
        }
      }
    }

    // Process kind:39002 (members without roles)
    // Users in kind 39002 are regular members
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

    // Create event factory
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    // Use GroupMessageBlueprint - auto-handles h-tag, hashtags, mentions, emojis
    const draft = await factory.create(
      GroupMessageBlueprint,
      { id: groupId, relay: relayUrl },
      content,
      {
        previous: [], // No threading for now
        emojis: options?.emojiTags?.map((e) => ({
          shortcode: e.shortcode,
          url: e.url,
        })),
      },
    );

    // Add q-tag for replies (NIP-29 specific, not in blueprint yet)
    if (options?.replyTo) {
      draft.tags.push(["q", options.replyTo]);
    }

    // Add NIP-92 imeta tags for blob attachments (not yet handled by applesauce)
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        draft.tags.push(["imeta", ...imetaParts]);
      }
    }

    // Sign the event
    const event = await factory.sign(draft);

    // Publish only to the group relay
    await publishEventToRelays(event, [relayUrl]);
  }

  /**
   * Send a reaction (kind 7) to a message in the group
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

    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
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

    // Add h-tag for group context (NIP-29 specific)
    draft.tags.push(["h", groupId]);

    // Sign the event
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
}
