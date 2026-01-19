import { Observable, firstValueFrom } from "rxjs";
import { map, toArray } from "rxjs/operators";
import type { Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
import {
  ChatProtocolAdapter,
  type SendMessageOptions,
  type ZapConfig,
} from "./base-adapter";
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
import { isValidZap } from "applesauce-common/helpers/zap";
import { EventFactory } from "applesauce-core/event-factory";
import {
  fetchEvent,
  getOutboxRelays,
  AGGREGATOR_RELAYS,
  zapReceiptToMessage,
  eventToMessage,
  getNip10ReplyTo,
} from "../utils";

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
    // This adapter only handles live-activity identifiers
    if (identifier.type !== "live-activity") {
      throw new Error(
        `NIP-53 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }
    const { pubkey, identifier: dTag } = identifier.value;
    const relayHints = identifier.relays || [];

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    console.log(
      `[NIP-53] Fetching live activity ${dTag} by ${pubkey.slice(0, 8)}...`,
    );

    // Use author's outbox relays plus any relay hints
    const authorOutboxes = await getOutboxRelays(pubkey, {
      maxRelays: 3,
      logPrefix: "[NIP-53]",
    });
    // If no outbox relays found, use aggregator relays as fallback
    const outboxFallback =
      authorOutboxes.length > 0 ? authorOutboxes : AGGREGATOR_RELAYS;
    const relays = [...new Set([...relayHints, ...outboxFallback])];

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
      ...new Set([...activity.relays, ...relayHints, ...outboxFallback]),
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
          goal: activity.goal,
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
    // Use immutable pattern to avoid mutating metadata
    const relays =
      liveActivity?.relays && liveActivity.relays.length > 0
        ? liveActivity.relays
        : conversation.metadata?.relayUrl
          ? [conversation.metadata.relayUrl]
          : [];

    if (relays.length === 0) {
      throw new Error("No relays available for live chat");
    }

    console.log(
      `[NIP-53] Loading messages for ${aTagValue} from ${relays.length} relays`,
    );

    // Single filter for live chat messages (kind 1311) and zaps (kind 9735)
    const filter: Filter = {
      kinds: [1311, 9735],
      "#a": [aTagValue],
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

    // Start a persistent subscription to the relays
    const subscription = pool
      .subscription(relays, [filter], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[NIP-53] EOSE received");
          } else {
            console.log(
              `[NIP-53] Received event k${response.kind}: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    // Store subscription for cleanup
    this.subscriptions.set(conversation.id, subscription);

    // Return observable from EventStore which will update automatically
    return eventStore.timeline(filter).pipe(
      map((events) => {
        const messages = events
          .map((event) => this.convertEventToMessage(event, conversation.id))
          .filter((msg): msg is Message => msg !== null);

        console.log(`[NIP-53] Timeline has ${messages.length} events`);
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

    // Get relays from live activity metadata or fall back to relayUrl
    // Use immutable pattern to avoid mutating metadata
    const relays =
      liveActivity?.relays && liveActivity.relays.length > 0
        ? liveActivity.relays
        : conversation.metadata?.relayUrl
          ? [conversation.metadata.relayUrl]
          : [];

    if (relays.length === 0) {
      throw new Error("No relays available for live chat");
    }

    console.log(
      `[NIP-53] Loading older messages for ${aTagValue} before ${before}`,
    );

    // Same filter as loadMessages but with until for pagination
    const filter: Filter = {
      kinds: [1311, 9735],
      "#a": [aTagValue],
      until: before,
      limit: 50,
    };

    // One-shot request to fetch older messages
    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(toArray()),
    );

    console.log(`[NIP-53] Loaded ${events.length} older events`);

    // Convert events to messages
    const messages = events
      .map((event) => this.convertEventToMessage(event, conversation.id))
      .filter((msg): msg is Message => msg !== null);

    // loadMoreMessages returns events in desc order from relay,
    // reverse for ascending chronological order
    return messages.reverse();
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

    // Get relays - use immutable pattern to avoid mutating metadata
    const relays =
      liveActivity?.relays && liveActivity.relays.length > 0
        ? liveActivity.relays
        : conversation.metadata?.relayUrl
          ? [conversation.metadata.relayUrl]
          : [];

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

    // Use kind 1311 for live chat messages
    const draft = await factory.build({ kind: 1311, content, tags });
    const event = await factory.sign(draft);

    // Publish to all activity relays
    await publishEventToRelays(event, relays);
  }

  /**
   * Send a reaction (kind 7) to a message in the live activity chat
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

    // Get relays - use immutable pattern to avoid mutating metadata
    const relays =
      liveActivity?.relays && liveActivity.relays.length > 0
        ? liveActivity.relays
        : conversation.metadata?.relayUrl
          ? [conversation.metadata.relayUrl]
          : [];

    if (relays.length === 0) {
      throw new Error("No relays available for sending reaction");
    }

    // Create event factory and sign event
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [
      ["e", messageId], // Event being reacted to
      ["a", aTagValue, relays[0] || ""], // Activity context (NIP-53 specific)
      ["k", "1311"], // Kind of event being reacted to (live chat message)
    ];

    // Add NIP-30 custom emoji tag if provided
    if (customEmoji) {
      tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
    }

    // Use kind 7 for reactions
    const draft = await factory.build({ kind: 7, content: emoji, tags });
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
   * Get zap configuration for a message in a live activity
   *
   * NIP-53 zap tagging rules:
   * - p-tag: message author (recipient)
   * - e-tag: message event being zapped
   * - a-tag: live activity context
   */
  getZapConfig(message: Message, conversation: Conversation): ZapConfig {
    const activityAddress = conversation.metadata?.activityAddress;
    const liveActivity = conversation.metadata?.liveActivity as
      | {
          relays?: string[];
        }
      | undefined;

    if (!activityAddress) {
      return {
        supported: false,
        unsupportedReason: "Missing activity address",
        recipientPubkey: "",
      };
    }

    const { pubkey: activityPubkey, identifier } = activityAddress;

    // Get relays
    const relays =
      liveActivity?.relays && liveActivity.relays.length > 0
        ? liveActivity.relays
        : conversation.metadata?.relayUrl
          ? [conversation.metadata.relayUrl]
          : [];

    // Build eventPointer for the message being zapped (e-tag)
    const eventPointer = {
      id: message.id,
      author: message.author,
      relays,
    };

    // Build addressPointer for the live activity (a-tag)
    const addressPointer = {
      kind: 30311,
      pubkey: activityPubkey,
      identifier,
      relays,
    };

    // Don't pass top-level relays - let createZapRequest collect outbox relays
    // from both eventPointer.author (recipient) and addressPointer.pubkey (stream host)
    // The relay hints in the pointers will also be included
    return {
      supported: true,
      recipientPubkey: message.author,
      eventPointer,
      addressPointer,
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
    // Get relays from conversation metadata
    const relays = this.getConversationRelays(conversation);

    return fetchEvent(eventId, {
      relayHints: relays,
      timeout: 3000,
      logPrefix: "[NIP-53]",
    });
  }

  /**
   * Helper: Get relays from conversation metadata
   */
  private getConversationRelays(conversation: Conversation): string[] {
    const liveActivity = conversation.metadata?.liveActivity as
      | { relays?: string[] }
      | undefined;

    if (liveActivity?.relays && liveActivity.relays.length > 0) {
      return liveActivity.relays;
    }

    if (conversation.metadata?.relayUrl) {
      return [conversation.metadata.relayUrl];
    }

    return [];
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
   * Helper: Convert Nostr event to Message using shared utilities
   */
  private convertEventToMessage(
    event: NostrEvent,
    conversationId: string,
  ): Message | null {
    // Convert zap receipts (kind 9735)
    if (event.kind === 9735) {
      if (!isValidZap(event)) return null;
      return zapReceiptToMessage(event, {
        conversationId,
        protocol: "nip-53",
      });
    }

    // All other events (kind 1311) use eventToMessage with NIP-10 style reply extraction
    return eventToMessage(event, {
      conversationId,
      protocol: "nip-53",
      getReplyTo: getNip10ReplyTo,
    });
  }
}
