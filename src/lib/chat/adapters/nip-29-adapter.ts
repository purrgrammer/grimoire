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
  fetchEvent,
  nutzapToMessage,
  eventToMessage,
  getQTagReplyTo,
} from "../utils";

const LOG_PREFIX = "[NIP-29]";

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
        // Not a valid naddr
      }
    }

    // NIP-29 format: [wss://]relay'group-id
    const match = input.match(/^((?:wss?:\/\/)?[^']+)'([^']+)$/);
    if (!match) return null;

    let [, relayUrl] = match;
    const groupId = match[2];

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
      `${LOG_PREFIX} Fetching group metadata for ${groupId} from ${relayUrl}`,
    );

    // Fetch group metadata (kind 39000)
    const metadataFilter: Filter = {
      kinds: [39000],
      "#d": [groupId],
      limit: 1,
    };

    const metadataEvents = await this.fetchFromRelay(relayUrl, metadataFilter);
    const metadataEvent = metadataEvents[0];

    if (metadataEvent) {
      console.log(`${LOG_PREFIX} Metadata event tags:`, metadataEvent.tags);
    }

    const title = metadataEvent
      ? getTagValues(metadataEvent, "name")[0] || groupId
      : groupId;
    const description = metadataEvent
      ? getTagValues(metadataEvent, "about")[0]
      : undefined;
    const icon = metadataEvent
      ? getTagValues(metadataEvent, "picture")[0]
      : undefined;

    console.log(`${LOG_PREFIX} Group title: ${title}`);

    // Fetch participants (kinds 39001 admins, 39002 members)
    const participantsFilter: Filter = {
      kinds: [39001, 39002],
      "#d": [groupId],
      limit: 10,
    };

    const participantEvents = await this.fetchFromRelay(
      relayUrl,
      participantsFilter,
    );
    const participants = this.extractParticipants(participantEvents);

    console.log(`${LOG_PREFIX} Found ${participants.length} participants`);

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

    console.log(
      `${LOG_PREFIX} Loading messages for ${groupId} from ${relayUrl}`,
    );

    const filter: Filter = {
      kinds: [9, 9000, 9001, 9321],
      "#h": [groupId],
      limit: options?.limit || 50,
    };

    if (options?.before) filter.until = options.before;
    if (options?.after) filter.since = options.after;

    const conversationId = `nip-29:${relayUrl}'${groupId}`;
    this.cleanup(conversationId);

    const subscription = pool
      .subscription([relayUrl], [filter], { eventStore })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log(`${LOG_PREFIX} EOSE received`);
          } else {
            console.log(
              `${LOG_PREFIX} Received event k${response.kind}: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    this.subscriptions.set(conversationId, subscription);

    return eventStore.timeline(filter).pipe(
      map((events) => {
        const messages = events.map((event) =>
          this.convertEventToMessage(event, conversationId),
        );
        console.log(`${LOG_PREFIX} Timeline has ${messages.length} events`);
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
      `${LOG_PREFIX} Loading older messages for ${groupId} before ${before}`,
    );

    const filter: Filter = {
      kinds: [9, 9000, 9001, 9321],
      "#h": [groupId],
      until: before,
      limit: 50,
    };

    const events = await firstValueFrom(
      pool.request([relayUrl], [filter], { eventStore }).pipe(toArray()),
    );

    console.log(`${LOG_PREFIX} Loaded ${events.length} older events`);

    const conversationId = conversation.id;
    return events
      .map((event) => this.convertEventToMessage(event, conversationId))
      .reverse();
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

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [["h", groupId]];

    if (options?.replyTo) {
      tags.push(["q", options.replyTo]);
    }

    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        tags.push(["imeta", ...imetaParts]);
      }
    }

    const draft = await factory.build({ kind: 9, content, tags });
    const event = await factory.sign(draft);

    await publishEventToRelays(event, [relayUrl]);
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

    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;

    if (!groupId || !relayUrl) {
      throw new Error("Group ID and relay URL required");
    }

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["e", messageId],
      ["h", groupId],
      ["k", "9"],
    ];

    if (customEmoji) {
      tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
    }

    const draft = await factory.build({ kind: 7, content: emoji, tags });
    const event = await factory.sign(draft);

    await publishEventToRelays(event, [relayUrl]);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false,
      supportsThreading: true,
      supportsModeration: true,
      supportsRoles: true,
      supportsGroupManagement: true,
      canCreateConversations: false,
      requiresRelay: true,
    };
  }

  /**
   * Get available actions for NIP-29 groups
   */
  getActions(options?: GetActionsOptions): ChatAction[] {
    const actions: ChatAction[] = [];

    if (!options?.conversation || !options?.activePubkey) {
      return this.getAllActions();
    }

    const { conversation, activePubkey } = options;
    const userParticipant = conversation.participants.find(
      (p) => p.pubkey === activePubkey,
    );
    const isMember = !!userParticipant;

    if (!isMember) {
      actions.push(this.createJoinAction());
    }

    if (isMember) {
      actions.push(this.createLeaveAction());
    }

    actions.push(this.createBookmarkAction());
    actions.push(this.createUnbookmarkAction());

    return actions;
  }

  /**
   * Load a replied-to message
   */
  async loadReplyMessage(
    conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    const relayUrl = conversation.metadata?.relayUrl;

    return fetchEvent(eventId, {
      relayHints: relayUrl ? [relayUrl] : [],
      logPrefix: LOG_PREFIX,
    });
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

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["h", groupId],
      ["relay", relayUrl],
    ];

    const draft = await factory.build({ kind: 9021, content: "", tags });
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

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["h", groupId],
      ["relay", relayUrl],
    ];

    const draft = await factory.build({ kind: 9022, content: "", tags });
    const event = await factory.sign(draft);
    await publishEventToRelays(event, [relayUrl]);
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

    const normalizedRelayUrl = normalizeRelayURL(relayUrl);

    const currentEvent = await firstValueFrom(
      eventStore.replaceable(10009, activePubkey, ""),
      { defaultValue: undefined },
    );

    let tags: string[][] = [];

    if (currentEvent) {
      tags = [...currentEvent.tags];

      const existingGroup = tags.find((t) =>
        this.isMatchingGroupTag(t, groupId, normalizedRelayUrl),
      );

      if (existingGroup) {
        throw new Error("Group is already in your list");
      }
    }

    tags.push(["group", groupId, normalizedRelayUrl]);

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const draft = await factory.build({ kind: 10009, content: "", tags });
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

    const normalizedRelayUrl = normalizeRelayURL(relayUrl);

    const currentEvent = await firstValueFrom(
      eventStore.replaceable(10009, activePubkey, ""),
      { defaultValue: undefined },
    );

    if (!currentEvent) {
      throw new Error("No group list found");
    }

    const originalLength = currentEvent.tags.length;
    const tags = currentEvent.tags.filter(
      (t) => !this.isMatchingGroupTag(t, groupId, normalizedRelayUrl),
    );

    if (tags.length === originalLength) {
      throw new Error("Group is not in your list");
    }

    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const draft = await factory.build({ kind: 10009, content: "", tags });
    const event = await factory.sign(draft);
    await publishEvent(event);
  }

  // --- Private helpers ---

  /**
   * Fetch events from a relay with timeout
   */
  private async fetchFromRelay(
    relayUrl: string,
    filter: Filter,
  ): Promise<NostrEvent[]> {
    const events: NostrEvent[] = [];
    const obs = pool.subscription([relayUrl], [filter], { eventStore });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`${LOG_PREFIX} Fetch timeout`);
        resolve();
      }, 5000);

      const sub = obs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            clearTimeout(timeout);
            console.log(`${LOG_PREFIX} Got ${events.length} events`);
            sub.unsubscribe();
            resolve();
          } else {
            events.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error(`${LOG_PREFIX} Fetch error:`, err);
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    return events;
  }

  /**
   * Extract participants from admin/member events
   */
  private extractParticipants(events: NostrEvent[]): Participant[] {
    const normalizeRole = (role: string | undefined): ParticipantRole => {
      if (!role) return "member";
      const lower = role.toLowerCase();
      if (lower === "admin") return "admin";
      if (lower === "moderator") return "moderator";
      if (lower === "host") return "host";
      return "member";
    };

    const participantsMap = new Map<string, Participant>();

    // Process admins (kind 39001)
    for (const event of events.filter((e) => e.kind === 39001)) {
      for (const tag of event.tags) {
        if (tag[0] === "p" && tag[1]) {
          const pubkey = tag[1];
          const roles = tag.slice(2).filter((r) => r);
          const primaryRole = normalizeRole(roles[0]);
          participantsMap.set(pubkey, { pubkey, role: primaryRole });
        }
      }
    }

    // Process members (kind 39002)
    for (const event of events.filter((e) => e.kind === 39002)) {
      for (const tag of event.tags) {
        if (tag[0] === "p" && tag[1]) {
          const pubkey = tag[1];
          if (!participantsMap.has(pubkey)) {
            participantsMap.set(pubkey, { pubkey, role: "member" });
          }
        }
      }
    }

    return Array.from(participantsMap.values());
  }

  /**
   * Check if a tag matches a group
   */
  private isMatchingGroupTag(
    tag: string[],
    groupId: string,
    normalizedRelayUrl: string,
  ): boolean {
    if (tag[0] !== "group" || tag[1] !== groupId) {
      return false;
    }
    try {
      const tagRelayUrl = tag[2];
      if (!tagRelayUrl) return false;
      return normalizeRelayURL(tagRelayUrl) === normalizedRelayUrl;
    } catch {
      return tag[2] === normalizedRelayUrl;
    }
  }

  /**
   * Convert event to Message
   */
  private convertEventToMessage(
    event: NostrEvent,
    conversationId: string,
  ): Message {
    // Nutzaps (kind 9321)
    if (event.kind === 9321) {
      return nutzapToMessage(event, {
        conversationId,
        protocol: "nip-29",
      });
    }

    // Admin events (join/leave) as system messages
    if (event.kind === 9000 || event.kind === 9001) {
      const pTags = event.tags.filter((t) => t[0] === "p");
      const affectedPubkey = pTags[0]?.[1] || event.pubkey;

      const content = event.kind === 9000 ? "joined" : "left";

      return eventToMessage(
        { ...event, content, pubkey: affectedPubkey },
        {
          conversationId,
          protocol: "nip-29",
          type: "system",
        },
      );
    }

    // Regular chat messages (kind 9)
    return eventToMessage(event, {
      conversationId,
      protocol: "nip-29",
      getReplyTo: getQTagReplyTo,
    });
  }

  /**
   * Get all possible actions
   */
  private getAllActions(): ChatAction[] {
    return [
      this.createJoinAction(),
      this.createLeaveAction(),
      this.createBookmarkAction(),
      this.createUnbookmarkAction(),
    ];
  }

  private createJoinAction(): ChatAction {
    return {
      name: "join",
      description: "Request to join the group",
      handler: async (context) => {
        try {
          await this.joinConversation(context.conversation);
          return { success: true, message: "Join request sent" };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to join group",
          };
        }
      },
    };
  }

  private createLeaveAction(): ChatAction {
    return {
      name: "leave",
      description: "Leave the group",
      handler: async (context) => {
        try {
          await this.leaveConversation(context.conversation);
          return { success: true, message: "You left the group" };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to leave group",
          };
        }
      },
    };
  }

  private createBookmarkAction(): ChatAction {
    return {
      name: "bookmark",
      description: "Add group to your group list",
      handler: async (context) => {
        try {
          await this.bookmarkGroup(context.conversation, context.activePubkey);
          return { success: true, message: "Group added to your list" };
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
    };
  }

  private createUnbookmarkAction(): ChatAction {
    return {
      name: "unbookmark",
      description: "Remove group from your group list",
      handler: async (context) => {
        try {
          await this.unbookmarkGroup(
            context.conversation,
            context.activePubkey,
          );
          return { success: true, message: "Group removed from your list" };
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
    };
  }
}
