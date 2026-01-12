import { Observable, combineLatest } from "rxjs";
import { map, first } from "rxjs/operators";
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
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import {
  parseLiveActivity,
  getLiveStatus,
  getLiveHost,
} from "@/lib/live-activity";
import {
  getZapAmount,
  getZapRequest,
  getZapSender,
  isValidZap,
} from "applesauce-common/helpers/zap";
import { EventFactory } from "applesauce-core/event-factory";

/**
 * NIP-53 Adapter - Live Activity Chat
 *
 * Features:
 * - Live streaming event chat (kind 1311)
 * - Public, unencrypted messages
 * - Host, speaker, and participant roles
 * - Multi-relay support (from relays tag or naddr hints)
 *
 * Identifier format: naddr1... (kind 30311 live activity address)
 * Messages reference activity via "a" tag
 */
export class Nip53Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-53" as const;
  readonly type = "live-chat" as const;

  /**
   * Parse identifier - accepts naddr format for kind 30311
   * Examples:
   *   - naddr1... (kind 30311 live activity address)
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    if (!input.startsWith("naddr1")) {
      return null;
    }

    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "naddr" && decoded.data.kind === 30311) {
        const { pubkey, identifier, relays } = decoded.data;

        return {
          type: "live-activity",
          value: {
            kind: 30311,
            pubkey,
            identifier,
          },
          relays: relays || [],
        };
      }
    } catch {
      // Not a valid naddr
    }

    return null;
  }

  /**
   * Resolve conversation from live activity address
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    const { pubkey, identifier: dTag } = identifier.value as {
      kind: number;
      pubkey: string;
      identifier: string;
    };
    const relayHints = identifier.relays || [];

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    console.log(
      `[NIP-53] Fetching live activity ${dTag} by ${pubkey.slice(0, 8)}...`,
    );

    // Use author's outbox relays plus any relay hints
    const authorOutboxes = await this.getAuthorOutboxes(pubkey);
    const relays = [...new Set([...relayHints, ...authorOutboxes])];

    if (relays.length === 0) {
      throw new Error("No relays available to fetch live activity");
    }

    console.log(`[NIP-53] Using relays: ${relays.join(", ")}`);

    // Fetch the kind 30311 live activity event
    const activityFilter: Filter = {
      kinds: [30311],
      authors: [pubkey],
      "#d": [dTag],
      limit: 1,
    };

    const activityEvents: NostrEvent[] = [];
    const activityObs = pool.subscription(relays, [activityFilter], {
      eventStore,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-53] Activity fetch timeout");
        resolve();
      }, 5000);

      const sub = activityObs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE received
            clearTimeout(timeout);
            console.log(
              `[NIP-53] Got ${activityEvents.length} activity events`,
            );
            sub.unsubscribe();
            resolve();
          } else {
            // Event received
            activityEvents.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-53] Activity fetch error:", err);
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    const activityEvent = activityEvents[0];

    if (!activityEvent) {
      throw new Error(`Live activity not found: ${pubkey.slice(0, 8)}:${dTag}`);
    }

    // Parse the live activity for rich metadata
    const activity = parseLiveActivity(activityEvent);
    const status = getLiveStatus(activityEvent);
    const hostPubkey = getLiveHost(activityEvent);

    // Map live activity roles to chat participant roles
    const participants: Participant[] = activity.participants.map((p) => ({
      pubkey: p.pubkey,
      role: this.mapRole(p.role),
    }));

    // Ensure host is in participants list
    if (!participants.some((p) => p.pubkey === hostPubkey)) {
      participants.unshift({ pubkey: hostPubkey, role: "host" });
    }

    // Combine activity relays, relay hints, and host outboxes for comprehensive coverage
    const chatRelays = [
      ...new Set([...activity.relays, ...relayHints, ...authorOutboxes]),
    ];

    console.log(
      `[NIP-53] Resolved: "${activity.title}" (${status}), ${participants.length} participants, ${chatRelays.length} relays`,
    );

    return {
      id: `nip-53:${pubkey}:${dTag}`,
      type: "live-chat",
      protocol: "nip-53",
      title: activity.title || "Live Activity",
      participants,
      metadata: {
        activityAddress: {
          kind: 30311,
          pubkey,
          identifier: dTag,
        },
        // Live activity specific metadata
        relayUrl: chatRelays[0], // Primary relay for compatibility
        description: activity.summary,
        icon: activity.image,
        // Extended live activity metadata
        liveActivity: {
          status,
          streaming: activity.streaming,
          recording: activity.recording,
          starts: activity.starts,
          ends: activity.ends,
          hostPubkey,
          currentParticipants: activity.currentParticipants,
          totalParticipants: activity.totalParticipants,
          hashtags: activity.hashtags,
          relays: chatRelays,
        },
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a live activity
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const activityAddress = conversation.metadata?.activityAddress;
    const liveActivity = conversation.metadata?.liveActivity as
      | {
          relays?: string[];
          hostPubkey?: string;
        }
      | undefined;

    if (!activityAddress) {
      throw new Error("Activity address required");
    }

    const { pubkey, identifier } = activityAddress;
    const aTagValue = `30311:${pubkey}:${identifier}`;

    // Get relays from live activity metadata or fall back to relayUrl
    const relays = liveActivity?.relays || [];
    if (relays.length === 0 && conversation.metadata?.relayUrl) {
      relays.push(conversation.metadata.relayUrl);
    }

    if (relays.length === 0) {
      throw new Error("No relays available for live chat");
    }

    console.log(
      `[NIP-53] Loading messages for ${aTagValue} from ${relays.length} relays`,
    );

    // Filter for live chat messages (kind 1311)
    const chatFilter: Filter = {
      kinds: [1311],
      "#a": [aTagValue],
      limit: options?.limit || 50,
    };

    // Filter for zaps (kind 9735) targeting this activity
    const zapFilter: Filter = {
      kinds: [9735],
      "#a": [aTagValue],
      limit: options?.limit || 50,
    };

    if (options?.before) {
      chatFilter.until = options.before;
      zapFilter.until = options.before;
    }
    if (options?.after) {
      chatFilter.since = options.after;
      zapFilter.since = options.after;
    }

    // Start persistent subscriptions to the relays for both chat and zaps
    pool
      .subscription(relays, [chatFilter], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[NIP-53] EOSE received for messages");
          } else {
            console.log(
              `[NIP-53] Received message: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    pool
      .subscription(relays, [zapFilter], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[NIP-53] EOSE received for zaps");
          } else {
            console.log(`[NIP-53] Received zap: ${response.id.slice(0, 8)}...`);
          }
        },
      });

    // Combine chat messages and zaps from EventStore
    const chatMessages$ = eventStore.timeline(chatFilter);
    const zapMessages$ = eventStore.timeline(zapFilter);

    return combineLatest([chatMessages$, zapMessages$]).pipe(
      map(([chatEvents, zapEvents]) => {
        const chatMsgs = chatEvents.map((event) =>
          this.eventToMessage(event, conversation.id),
        );

        const zapMsgs = zapEvents
          .filter((event) => isValidZap(event))
          .map((event) => this.zapToMessage(event, conversation.id));

        const allMessages = [...chatMsgs, ...zapMsgs];
        console.log(
          `[NIP-53] Timeline has ${chatMsgs.length} messages, ${zapMsgs.length} zaps`,
        );

        return allMessages.sort((a, b) => a.timestamp - b.timestamp);
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
    // Pagination to be implemented later
    return [];
  }

  /**
   * Send a message to the live activity chat
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

    const activityAddress = conversation.metadata?.activityAddress;
    const liveActivity = conversation.metadata?.liveActivity as
      | {
          relays?: string[];
        }
      | undefined;

    if (!activityAddress) {
      throw new Error("Activity address required");
    }

    const { pubkey, identifier } = activityAddress;
    const aTagValue = `30311:${pubkey}:${identifier}`;

    // Get relays
    const relays = liveActivity?.relays || [];
    if (relays.length === 0 && conversation.metadata?.relayUrl) {
      relays.push(conversation.metadata.relayUrl);
    }

    if (relays.length === 0) {
      throw new Error("No relays available for sending message");
    }

    // Create event factory and sign event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    // Build tags: a tag is required, e tag for replies
    const tags: string[][] = [["a", aTagValue, relays[0] || ""]];

    if (options?.replyTo) {
      // NIP-53 uses e-tag for replies (NIP-10 style)
      tags.push(["e", options.replyTo, relays[0] || "", "reply"]);
    }

    // Add NIP-30 emoji tags
    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    // Use kind 1311 for live chat messages
    const draft = await factory.build({ kind: 1311, content, tags });
    const event = await factory.sign(draft);

    // Publish to all activity relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false, // kind 1311 messages are public
      supportsThreading: true, // e-tag replies
      supportsModeration: false, // No built-in moderation (host can pin)
      supportsRoles: true, // Host, Speaker, Participant
      supportsGroupManagement: false, // No join/leave semantics
      canCreateConversations: false, // Activities created via streaming software
      requiresRelay: false, // Works across multiple relays
    };
  }

  /**
   * Load a replied-to message
   * First checks EventStore, then fetches from relays if needed
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

    // Not in store, fetch from activity relays
    const liveActivity = conversation.metadata?.liveActivity as
      | {
          relays?: string[];
        }
      | undefined;
    const relays = liveActivity?.relays || [];
    if (relays.length === 0 && conversation.metadata?.relayUrl) {
      relays.push(conversation.metadata.relayUrl);
    }

    if (relays.length === 0) {
      console.warn("[NIP-53] No relays for loading reply message");
      return null;
    }

    console.log(
      `[NIP-53] Fetching reply message ${eventId.slice(0, 8)}... from ${relays.length} relays`,
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
          `[NIP-53] Reply message fetch timeout for ${eventId.slice(0, 8)}...`,
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
          console.error(`[NIP-53] Reply message fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0] || null;
  }

  /**
   * Helper: Get author's outbox relays via NIP-65
   */
  private async getAuthorOutboxes(pubkey: string): Promise<string[]> {
    try {
      // Try to get from EventStore first (kind 10002)
      const relayListEvent = await eventStore
        .replaceable(10002, pubkey)
        .pipe(first())
        .toPromise();

      if (relayListEvent) {
        // Extract write relays from r tags
        const writeRelays = relayListEvent.tags
          .filter((t) => t[0] === "r" && (!t[2] || t[2] === "write"))
          .map((t) => t[1])
          .filter(Boolean);

        if (writeRelays.length > 0) {
          return writeRelays.slice(0, 3); // Limit to 3 relays
        }
      }
    } catch {
      // Fall through to defaults
    }

    // Default fallback relays for live activities
    return ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
  }

  /**
   * Helper: Map live activity role to chat participant role
   */
  private mapRole(role: string): ParticipantRole {
    const lower = role.toLowerCase();
    if (lower === "host") return "host";
    if (lower === "speaker") return "moderator"; // Speakers get elevated display
    if (lower === "moderator") return "moderator";
    return "member";
  }

  /**
   * Helper: Convert Nostr event to Message
   */
  private eventToMessage(event: NostrEvent, conversationId: string): Message {
    // Look for reply e-tags (NIP-10 style)
    const eTags = event.tags.filter((t) => t[0] === "e");
    // Find the reply tag (has "reply" marker or is the last e-tag without marker)
    const replyTag =
      eTags.find((t) => t[3] === "reply") ||
      eTags.find((t) => !t[3] && eTags.length === 1);
    const replyTo = replyTag?.[1];

    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo,
      protocol: "nip-53",
      metadata: {
        encrypted: false,
      },
      event,
    };
  }

  /**
   * Helper: Convert zap receipt to Message
   */
  private zapToMessage(event: NostrEvent, conversationId: string): Message {
    const zapSender = getZapSender(event);
    const zapAmount = getZapAmount(event);
    const zapRequest = getZapRequest(event);

    // Convert from msats to sats
    const amountInSats = zapAmount ? Math.floor(zapAmount / 1000) : 0;

    // Get zap comment from request
    const zapComment = zapRequest?.content || "";

    // The recipient is the pubkey in the p tag of the zap receipt
    const pTag = event.tags.find((t) => t[0] === "p");
    const zapRecipient = pTag?.[1] || event.pubkey;

    return {
      id: event.id,
      conversationId,
      author: zapSender || event.pubkey,
      content: zapComment,
      timestamp: event.created_at,
      type: "zap",
      protocol: "nip-53",
      metadata: {
        encrypted: false,
        zapAmount: amountInSats,
        zapRecipient,
      },
      event,
    };
  }
}
