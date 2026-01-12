import { Observable } from "rxjs";
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
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import { getTagValues } from "@/lib/nostr-utils";
import { EventFactory } from "applesauce-core/event-factory";
import { getProfileContent } from "applesauce-core/helpers";
import {
  getCommunikeyRelays,
  getCommunikeyDescription,
  getCommunikeyContentSections,
} from "@/lib/communikeys-helpers";
import { isValidHexPubkey, normalizeHex } from "@/lib/nostr-validation";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

const COMMUNIKEY_KIND = 10222;

/**
 * Communikeys Adapter - Community-Based Groups
 *
 * Features:
 * - Any npub can become a community
 * - Community config from kind:10222, profile from kind:0
 * - Chat messages use kind:9 with h-tag containing community pubkey
 * - Relays specified in community config (kind:10222 r-tags)
 *
 * Identifier formats:
 * - npub1... (any npub can be a community)
 * - nprofile1... (with relay hints)
 * - naddr1... (kind 10222 community definition)
 * - hex pubkey (64 chars)
 */
export class CommunikeysAdapter extends ChatProtocolAdapter {
  readonly protocol = "communikeys" as const;
  readonly type = "group" as const;

  /**
   * Parse identifier - accepts npub, nprofile, naddr (kind 10222), or hex pubkey
   * Returns null if identifier doesn't look like a pubkey or communikey address
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try npub format
    if (input.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          return {
            type: "communikey",
            value: decoded.data,
            relays: [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try nprofile format (with relay hints)
    if (input.startsWith("nprofile1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "nprofile") {
          return {
            type: "communikey",
            value: decoded.data.pubkey,
            relays: decoded.data.relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try naddr format (kind 10222 community definition)
    if (input.startsWith("naddr1")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "naddr" && decoded.data.kind === COMMUNIKEY_KIND) {
          // For kind 10222, the pubkey IS the community identifier
          return {
            type: "communikey",
            value: decoded.data.pubkey,
            relays: decoded.data.relays || [],
          };
        }
      } catch {
        return null;
      }
    }

    // Try hex pubkey (64 chars)
    if (isValidHexPubkey(input)) {
      return {
        type: "communikey",
        value: normalizeHex(input),
        relays: [],
      };
    }

    return null;
  }

  /**
   * Resolve conversation from community pubkey
   * Fetches kind:0 profile and kind:10222 community config
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    const communityPubkey = identifier.value;
    const hintRelays = identifier.relays || [];

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    console.log(
      `[Communikeys] Fetching community config for ${communityPubkey.slice(0, 8)}...`,
    );

    // Use hint relays + aggregators for fetching metadata
    const fetchRelays = [...hintRelays, ...AGGREGATOR_RELAYS.slice(0, 3)];

    // Fetch community config (kind:10222) and profile (kind:0)
    const filter: Filter = {
      kinds: [0, COMMUNIKEY_KIND],
      authors: [communityPubkey],
      limit: 2,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription(fetchRelays, [filter], { eventStore });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log("[Communikeys] Metadata fetch timeout");
        resolve();
      }, 5000);

      const sub = obs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE received
            clearTimeout(timeout);
            console.log(`[Communikeys] Got ${events.length} metadata events`);
            sub.unsubscribe();
            resolve();
          } else {
            events.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[Communikeys] Metadata fetch error:", err);
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    // Extract profile and community config
    const profileEvent = events.find((e) => e.kind === 0);
    const configEvent = events.find((e) => e.kind === COMMUNIKEY_KIND);

    // Parse profile
    const profile = profileEvent ? getProfileContent(profileEvent) : null;
    const displayName =
      profile?.display_name ||
      profile?.name ||
      `${communityPubkey.slice(0, 8)}...`;

    // Parse community config
    let communityRelays: string[] = [];
    let description: string | undefined;

    if (configEvent) {
      communityRelays = getCommunikeyRelays(configEvent);
      description = getCommunikeyDescription(configEvent) || profile?.about;

      // Check if chat is supported (kind 9 in content sections)
      const sections = getCommunikeyContentSections(configEvent);
      const hasChat = sections.some((s) => s.kinds.includes(9));
      if (!hasChat) {
        console.warn(
          "[Communikeys] Community does not have chat enabled (kind 9)",
        );
      }
    }

    console.log(
      `[Communikeys] Community: ${displayName}, relays: ${communityRelays.length}`,
    );

    return {
      id: `communikeys:${communityPubkey}`,
      type: "group",
      protocol: "communikeys",
      title: displayName,
      // Community pubkey is the admin, other members derived from messages in ChatViewer
      participants: [{ pubkey: communityPubkey, role: "host" as const }],
      metadata: {
        communityPubkey,
        communityRelays,
        description,
        icon: profile?.picture,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a community
   * Uses kind:9 messages with h-tag = community pubkey
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const communityPubkey = conversation.metadata?.communityPubkey;
    const communityRelays = conversation.metadata?.communityRelays || [];

    if (!communityPubkey) {
      throw new Error("Community pubkey required");
    }

    // Use community relays + aggregators for fetching
    const fetchRelays =
      communityRelays.length > 0
        ? communityRelays
        : AGGREGATOR_RELAYS.slice(0, 3);

    console.log(
      `[Communikeys] Loading messages for ${communityPubkey.slice(0, 8)}... from ${fetchRelays.length} relays`,
    );

    // Subscribe to chat messages (kind 9) with h-tag = community pubkey
    const filter: Filter = {
      kinds: [9],
      "#h": [communityPubkey],
      limit: options?.limit || 50,
    };

    if (options?.before) {
      filter.until = options.before;
    }
    if (options?.after) {
      filter.since = options.after;
    }

    // Start persistent subscription
    pool.subscription(fetchRelays, [filter], { eventStore }).subscribe({
      next: (response) => {
        if (typeof response === "string") {
          console.log("[Communikeys] EOSE received for messages");
        } else {
          console.log(
            `[Communikeys] Received message: ${response.id.slice(0, 8)}...`,
          );
        }
      },
    });

    // Return observable from EventStore
    return eventStore.timeline(filter).pipe(
      map((events) => {
        console.log(`[Communikeys] Timeline has ${events.length} messages`);
        return events
          .map((event) => this.eventToMessage(event, conversation.id))
          .sort((a, b) => a.timestamp - b.timestamp);
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
    // Pagination to be implemented
    return [];
  }

  /**
   * Send a message to the community
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

    const communityPubkey = conversation.metadata?.communityPubkey;
    const communityRelays = conversation.metadata?.communityRelays || [];

    if (!communityPubkey) {
      throw new Error("Community pubkey required");
    }

    // Use community relays for publishing
    const publishRelays =
      communityRelays.length > 0
        ? communityRelays
        : AGGREGATOR_RELAYS.slice(0, 3);

    // Create event with h-tag = community pubkey
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    const tags: string[][] = [["h", communityPubkey]];

    if (options?.replyTo) {
      // Use q-tag for replies (same as NIP-29 and NIP-C7)
      tags.push(["q", options.replyTo]);
    }

    // Add NIP-30 emoji tags
    if (options?.emojiTags) {
      for (const emoji of options.emojiTags) {
        tags.push(["emoji", emoji.shortcode, emoji.url]);
      }
    }

    // Use kind 9 for chat messages
    const draft = await factory.build({ kind: 9, content, tags });
    const event = await factory.sign(draft);

    // Publish to community relays
    await publishEventToRelays(event, publishRelays);
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: false, // kind 9 messages are public
      supportsThreading: true, // q-tag replies
      supportsModeration: false, // badge-based, not relay-enforced
      supportsRoles: true, // badge-based roles
      supportsGroupManagement: false, // no join/leave required
      canCreateConversations: false, // communities are created by publishing kind:10222
      requiresRelay: true, // needs community relays
    };
  }

  /**
   * Load a replied-to message
   */
  async loadReplyMessage(
    conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // Check EventStore first
    const cachedEvent = await eventStore
      .event(eventId)
      .pipe(first())
      .toPromise();
    if (cachedEvent) {
      return cachedEvent;
    }

    // Fetch from community relays
    const communityRelays = conversation.metadata?.communityRelays || [];
    const fetchRelays =
      communityRelays.length > 0
        ? communityRelays
        : AGGREGATOR_RELAYS.slice(0, 3);

    console.log(
      `[Communikeys] Fetching reply message ${eventId.slice(0, 8)}...`,
    );

    const filter: Filter = {
      ids: [eventId],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const obs = pool.subscription(fetchRelays, [filter], { eventStore });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(
          `[Communikeys] Reply message fetch timeout for ${eventId.slice(0, 8)}...`,
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
          console.error(`[Communikeys] Reply message fetch error:`, err);
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
    // Look for reply q-tags
    const qTags = getTagValues(event, "q");
    const replyTo = qTags[0];

    return {
      id: event.id,
      conversationId,
      author: event.pubkey,
      content: event.content,
      timestamp: event.created_at,
      type: "user",
      replyTo,
      protocol: "communikeys",
      metadata: {
        encrypted: false,
      },
      event,
    };
  }
}
