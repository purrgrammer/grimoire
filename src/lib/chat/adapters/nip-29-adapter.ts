import {
  BehaviorSubject,
  combineLatest,
  Observable,
  firstValueFrom,
} from "rxjs";
import { map, first, filter as filterOp } from "rxjs/operators";
import type { Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  GroupIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
  Participant,
  ParticipantRole,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import {
  toApplesauceEmoji,
  toApplesauceEmojis,
  type EmojiTag,
} from "@/lib/emoji-helpers";
import type { ChatAction, GetActionsOptions } from "@/types/chat-actions";
import eventStore from "@/services/event-store";
import {
  requestEvent,
  requestEvents,
  streamWithEose,
} from "@/lib/relay-subscription";
import { publishEventToRelays, publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";
import { getQuotePointer } from "@/lib/nostr-utils";
import { getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { mergeRelaySets } from "applesauce-core/helpers";
import { normalizeRelayURL } from "@/lib/relay-url";
import {
  GroupMessageFactory,
  ReactionFactory,
} from "applesauce-common/factories";
import { resolveGroupMetadata } from "@/lib/chat/group-metadata-helpers";
import { markGroupRead, readGroupLastRead } from "@/services/nip29-reads";
import { parseGroupSelection } from "@/lib/nip29/group-selection";
import {
  buildUpdatePinListTags,
  KIND_GROUP_PIN_LIST,
  KIND_UPDATE_PIN_LIST,
  parsePinListEntries,
  withPinAdded,
  withPinRemoved,
  type PinEntry,
} from "@/lib/nip29/pins";

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
  // Narrower than the base signature on purpose: this adapter only ever yields
  // a group identifier, and saying so lets callers read `.value`/`.relays`
  // without narrowing a union that now includes shapes carrying neither.
  parseIdentifier(input: string): GroupIdentifier | null {
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
    const selection = parseGroupSelection(input);
    if (!selection) return null;

    return {
      type: "group",
      value: selection.groupId,
      relays: [selection.relayUrl],
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

    // Fetch group metadata from the specific relay (kind 39000)
    const metadataFilter: Filter = {
      kinds: [39000],
      "#d": [groupId],
      limit: 1,
    };

    // Admins (kind 39001) and members (kind 39002) — both keyed by d tag on
    // addressable events signed by the relay.
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

    // Independent requests, so run them concurrently: each is bounded
    // separately, and awaiting in sequence doubles the wait on a relay that
    // never answers.
    const [metadataEvents, participantEvents] = await Promise.all([
      requestEvents([relayUrl], [metadataFilter]),
      requestEvents([relayUrl], [adminsFilter, membersFilter]),
    ]);

    // Resolve group metadata with profile fallback
    const resolved = await resolveGroupMetadata(
      groupId,
      relayUrl,
      metadataEvents[0],
    );

    const title = resolved.name || groupId;
    const description = resolved.description;
    const icon = resolved.icon;

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
        // Stated only when the group has said no: an AV-only space
        // (`supported_kinds` present and empty, or listing kinds without 9)
        // would otherwise offer a composer whose every send the relay rejects.
        ...(resolved.supportedKinds && !resolved.supportedKinds.includes(9)
          ? { acceptsMessages: false }
          : {}),
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

    // Chat needs a stable bottom anchor, so hold rendering until the initial
    // batch has landed. Streaming instead needs a stable list anchor: #277.
    const eoseReceived$ = new BehaviorSubject<boolean>(false);

    const subscription = streamWithEose([relayUrl], [filter], {
      onEose: () => eoseReceived$.next(true),
      onStatus: options?.onStatus,
    }).subscribe();

    // Store subscription for cleanup
    this.subscriptions.set(conversationId, subscription);

    return combineLatest([eventStore.timeline(filter), eoseReceived$]).pipe(
      filterOp(([, eose]) => eose),
      map(([events]) => {
        const messages = events.map((event) => {
          // Convert nutzaps (kind 9321) using nutzapToMessage
          if (event.kind === 9321) {
            return this.nutzapToMessage(event, conversation.id);
          }
          // All other events use eventToMessage
          return this.eventToMessage(event, conversation.id);
        });

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

    // Same filter as loadMessages but with until for pagination
    const filter: Filter = {
      kinds: [9, 9000, 9001, 9321],
      "#h": [groupId],
      until: before,
      limit: 50,
    };

    // One-shot request to fetch older messages
    const events = await requestEvents([relayUrl], [filter]);

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

    // Tags applesauce doesn't generate for us
    const extraTags: string[][] = [];

    // Add q-tag for replies (quote tag format)
    // Format: ["q", eventId, relayUrl, pubkey]
    if (options?.replyTo) {
      // Look up the event to get the author's pubkey for the q-tag
      const replyEvent = eventStore.getEvent(options.replyTo);
      if (replyEvent) {
        // Full q-tag with relay hint and author pubkey
        extraTags.push(["q", options.replyTo, relayUrl, replyEvent.pubkey]);
      } else {
        // Fallback: at minimum include the relay hint since we know it
        extraTags.push(["q", options.replyTo, relayUrl]);
      }
    }

    // Add NIP-92 imeta tags for blob attachments (not yet handled by applesauce)
    if (options?.blobAttachments) {
      for (const blob of options.blobAttachments) {
        const imetaParts = [`url ${blob.url}`];
        if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
        if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
        if (blob.size) imetaParts.push(`size ${blob.size}`);
        extraTags.push(["imeta", ...imetaParts]);
      }
    }

    // GroupMessageFactory auto-handles h-tag, hashtags, mentions and emojis
    const event = await GroupMessageFactory.create(
      { id: groupId, relay: relayUrl },
      content,
      {
        // No threading for now, so no .previous() refs are set
        emojis: options?.emojiTags
          ? toApplesauceEmojis(options.emojiTags)
          : undefined,
      },
    )
      .modifyPublicTags((tags) => [...tags, ...extraTags])
      .sign(activeSigner);

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
    customEmoji?: EmojiTag,
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

    // ReactionFactory auto-handles e-tag, k-tag, p-tag and custom emoji
    const emojiArg = customEmoji ? toApplesauceEmoji(customEmoji) : emoji;

    const event = await ReactionFactory.create(messageEvent, emojiArg)
      // Add h-tag for group context (NIP-29 specific)
      .modifyPublicTags((tags) => [...tags, ["h", groupId]])
      .sign(activeSigner);

    // Publish only to the group relay
    await publishEventToRelays(event, [relayUrl]);
  }

  /**
   * How far into this group the reader has caught up. Unix seconds, 0 for never.
   *
   * The pair is what `useReadMarker` drives: it captures this BEFORE the visit,
   * places the "New" divider against the frozen value, and only then stamps. The
   * hook is inert for an adapter that implements neither, which is what kept
   * NIP-29 badge-less until now.
   */
  async getLastRead(conversation: Conversation): Promise<number> {
    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;
    if (!groupId || !relayUrl) return 0;
    const pubkey = accountManager.active$.value?.pubkey;
    if (!pubkey) return 0;
    return readGroupLastRead(pubkey, relayUrl, groupId);
  }

  /**
   * Move the stamp — but never past the newest message the COUNT can see.
   *
   * `useReadMarker` hands over the newest of everything the pane loaded, and
   * this timeline renders 9000, 9001 and 9321 beside the kind 9 the badge
   * counts. Stamping that value clears the badge correctly, and it is still
   * wrong, because a NIP-29 stamp has a second consumer the other protocols'
   * do not: `useGroupMessageWindows` uses it as `since` on a `kinds:[9]` REQ.
   *
   * So a group whose newest event is a join — the reader's own kind 9000, the
   * common case right after joining — would ask the relay for kind 9 newer than
   * that join, get nothing, and lose its last message: a blank row in
   * `GroupListViewer` and last place in the recency sort, until somebody posted
   * again.
   *
   * Capping at the newest NON-FUTURE kind 9 fixes both halves at once. `since`
   * is inclusive, so that message always comes back, and the stamp can never be
   * a future fetch bound that silently excludes messages arriving under it.
   * Everything the count counts is at or below it, so the badge still clears.
   *
   * A future-dated kind 9 therefore counts before it can be stamped, and the
   * badge waits for the clock rather than for a reader — bounded by the message's
   * own offset, and it heals itself.
   */
  async markRead(
    conversation: Conversation,
    timestampSecs: number,
  ): Promise<void> {
    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;
    if (!groupId || !relayUrl) return;
    const pubkey = accountManager.active$.value?.pubkey;
    if (!pubkey) return;
    // Nothing loaded is not everything read.
    if (!Number.isFinite(timestampSecs) || timestampSecs <= 0) return;

    const nowSecs = Math.floor(Date.now() / 1000);
    // Descending, so the first non-future one is the newest.
    const newestCountable = eventStore
      .getTimeline({ kinds: [9], "#h": [groupId] })
      .find((event) => event.created_at <= nowSecs)?.created_at;
    // A group holding no countable message has nothing to mark: stamping the
    // join event that is all it holds would bound the REQ above every message
    // anyone posts next.
    if (!newestCountable) return;

    await markGroupRead(
      pubkey,
      relayUrl,
      groupId,
      Math.min(timestampSecs, newestCountable),
    );
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false, // kind 9 messages are public
      supportsThreading: true, // q-tag replies
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
   * First checks EventStore, then fetches from group relay and pointer relay hints
   */
  async loadReplyMessage(
    conversation: Conversation,
    pointer: EventPointer | AddressPointer,
  ): Promise<NostrEvent | null> {
    // Extract event ID from pointer (EventPointer has 'id', AddressPointer doesn't)
    const eventId = "id" in pointer ? pointer.id : null;

    if (!eventId) {
      // AddressPointer - not supported for loadReplyMessage (would need different logic)
      console.warn(
        "[NIP-29] AddressPointer not supported for loadReplyMessage",
      );
      return null;
    }

    // First check EventStore - might already be loaded
    const cachedEvent = await eventStore
      .event(eventId)
      .pipe(first())
      .toPromise();
    if (cachedEvent) {
      return cachedEvent;
    }

    // Build relay list: group relay + pointer relay hints (deduplicated and normalized)
    const groupRelayUrl = conversation.metadata?.relayUrl;
    const relays = mergeRelaySets(
      groupRelayUrl ? [groupRelayUrl] : [],
      pointer.relays || [],
    );

    if (relays.length === 0) {
      console.warn("[NIP-29] No relays available for loading reply message");
      return null;
    }

    const filter: Filter = {
      ids: [eventId],
      limit: 1,
    };

    try {
      return await requestEvent(relays, filter);
    } catch (err) {
      console.error("[NIP-29] Reply message fetch error:", err);
      return null;
    }
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
    const tags: string[][] = [
      ["h", groupId],
      ["relay", relayUrl],
    ];

    const event = await activeSigner.signEvent({
      kind: 9021,
      content: "",
      tags,
      created_at: Math.floor(Date.now() / 1000),
    });
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
    const tags: string[][] = [
      ["h", groupId],
      ["relay", relayUrl],
    ];

    const event = await activeSigner.signEvent({
      kind: 9022,
      content: "",
      tags,
      created_at: Math.floor(Date.now() / 1000),
    });
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
    const event = await activeSigner.signEvent({
      kind: 10009,
      content: "",
      tags,
      created_at: Math.floor(Date.now() / 1000),
    });
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
    const event = await activeSigner.signEvent({
      kind: 10009,
      content: "",
      tags,
      created_at: Math.floor(Date.now() / 1000),
    });
    await publishEvent(event);
  }

  /**
   * Pin an event into the group's pin list (`kind:9010`), replacing the
   * whole list — the only operation the NIP defines. A no-op if the event
   * is already pinned.
   *
   * The relay is the actual enforcer: it accepts the publish only from an
   * authorized admin/moderator and rejects everyone else, the same trust
   * model every other moderation kind in this adapter relies on.
   */
  async pinMessage(
    conversation: Conversation,
    messageId: string,
  ): Promise<void> {
    await this.updatePinList(conversation, (entries) =>
      withPinAdded(entries, { type: "e", id: messageId }),
    );
  }

  /** The inverse of {@link pinMessage}. */
  async unpinMessage(
    conversation: Conversation,
    messageId: string,
  ): Promise<void> {
    await this.updatePinList(conversation, (entries) =>
      withPinRemoved(entries, { type: "e", id: messageId }),
    );
  }

  /**
   * Read the group's current pin list, apply `transform`, and publish the
   * result as a new `kind:9010`.
   *
   * Read fresh from the relay rather than trusting whatever the store
   * already folded from `kind:39005` — the whole list is replaced on every
   * update, so a stale read would silently drop whatever another admin
   * pinned since this client last saw the mirror.
   */
  private async updatePinList(
    conversation: Conversation,
    transform: (entries: PinEntry[]) => PinEntry[],
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

    const currentEvent = await requestEvent([relayUrl], {
      kinds: [KIND_GROUP_PIN_LIST],
      "#d": [groupId],
      limit: 1,
    });
    const currentEntries = currentEvent
      ? parsePinListEntries(currentEvent.tags)
      : [];
    const nextEntries = transform(currentEntries);

    const event = await activeSigner.signEvent({
      kind: KIND_UPDATE_PIN_LIST,
      content: "",
      tags: buildUpdatePinListTags(groupId, nextEntries),
      created_at: Math.floor(Date.now() / 1000),
    });
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
        // put-user: admin adds someone
        // If p-tag has a role (3rd element), show "is/are now <role>" instead of "joined"
        const role = pTags[0]?.[2];
        const verb = pTags.length > 1 ? "are" : "is";
        content = role ? `${verb} now ${role}` : "joined";
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
    // Look for reply q-tags
    // Use getQuotePointer to extract full EventPointer with relay hints
    const replyTo = getQuotePointer(event);

    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo: replyTo || undefined,
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
    // Use getEventPointerFromETag to extract full pointer with relay hints
    const eTag = event.tags.find((t) => t[0] === "e");
    const replyTo = eTag
      ? (getEventPointerFromETag(eTag) ?? undefined)
      : undefined;

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
