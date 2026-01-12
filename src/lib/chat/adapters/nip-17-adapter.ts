import { Observable, firstValueFrom, from, of } from "rxjs";
import { map, first, switchMap, catchError } from "rxjs/operators";
import { nip19 } from "nostr-tools";
import type { Filter } from "nostr-tools";
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
import { isNip05, resolveNip05 } from "@/lib/nip05";
import { getDisplayName, getTagValues } from "@/lib/nostr-utils";
import { isValidHexPubkey } from "@/lib/nostr-validation";
import { getProfileContent } from "applesauce-core/helpers";
import { getRelaysFromList } from "applesauce-common/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import { addressLoader, AGGREGATOR_RELAYS } from "@/services/loaders";
import {
  unlockGiftWrap,
  isGiftWrapUnlocked,
  getGiftWrapRumor,
  type Rumor,
} from "applesauce-common/helpers/gift-wrap";
import { getConversationParticipants } from "applesauce-common/helpers/messages";
import {
  getWrappedMessageSender,
  getWrappedMessageParent,
} from "applesauce-common/helpers/wrapped-messages";
import { GiftWrapBlueprint } from "applesauce-common/blueprints/gift-wrap";
import { WrappedMessageBlueprint } from "applesauce-common/blueprints/wrapped-message";

/**
 * NIP-17 Adapter - Private Direct Messages
 *
 * Features:
 * - End-to-end encrypted messaging using NIP-44
 * - Gift-wrapped messages (NIP-59) for metadata privacy
 * - Uses DM inbox relays (kind 10050) for delivery
 * - Caches decrypted rumors to avoid repeated decryption
 *
 * Message flow:
 * 1. Create Rumor (kind 14, unsigned)
 * 2. Seal rumor (kind 13, encrypted to recipient)
 * 3. Gift wrap seal (kind 1059, encrypted with ephemeral key)
 * 4. Publish to recipient's DM inbox relays
 */
export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /** Cache of DM inbox relays by pubkey */
  private dmRelayCache = new Map<string, string[]>();

  /**
   * Parse identifier - accepts npub, nprofile, hex pubkey, or NIP-05
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Try bech32 decoding (npub/nprofile)
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "npub") {
        return {
          type: "dm-recipient",
          value: decoded.data,
        };
      }
      if (decoded.type === "nprofile") {
        return {
          type: "dm-recipient",
          value: decoded.data.pubkey,
          relays: decoded.data.relays,
        };
      }
    } catch {
      // Not bech32, try other formats
    }

    // Try hex pubkey
    if (isValidHexPubkey(input)) {
      return {
        type: "dm-recipient",
        value: input,
      };
    }

    // Try NIP-05
    if (isNip05(input)) {
      return {
        type: "chat-partner-nip05",
        value: input,
      };
    }

    return null;
  }

  /**
   * Resolve conversation from identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    let pubkey: string;

    // Resolve NIP-05 if needed
    if (identifier.type === "chat-partner-nip05") {
      const resolved = await resolveNip05(identifier.value);
      if (!resolved) {
        throw new Error(`Failed to resolve NIP-05: ${identifier.value}`);
      }
      pubkey = resolved;
    } else if (
      identifier.type === "dm-recipient" ||
      identifier.type === "chat-partner"
    ) {
      pubkey = identifier.value;
    } else {
      throw new Error(
        `NIP-17 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    console.log(
      `[NIP-17] Resolving conversation with ${pubkey.slice(0, 8)}...`,
    );

    // Fetch DM relays for both parties in parallel
    await Promise.all([
      this.fetchDmRelays(activePubkey),
      this.fetchDmRelays(pubkey),
    ]);

    // Get display name for partner
    const metadataEvent = await this.getMetadata(pubkey);
    const metadata = metadataEvent
      ? getProfileContent(metadataEvent)
      : undefined;
    const title = getDisplayName(pubkey, metadata);

    return {
      id: `nip-17:${pubkey}`,
      type: "dm",
      protocol: "nip-17",
      title,
      participants: [
        { pubkey: activePubkey, role: "member" },
        { pubkey, role: "member" },
      ],
      metadata: {
        encrypted: true,
        giftWrapped: true,
      },
      unreadCount: 0,
    };
  }

  /**
   * Fetch DM inbox relays (kind 10050) for a pubkey
   */
  private async fetchDmRelays(pubkey: string): Promise<string[]> {
    // Check cache first
    const cached = this.dmRelayCache.get(pubkey);
    if (cached) {
      return cached;
    }

    console.log(`[NIP-17] Fetching DM relays for ${pubkey.slice(0, 8)}...`);

    try {
      // Try to load kind 10050 from relays
      const event = await firstValueFrom(
        addressLoader({ kind: 10050, pubkey, identifier: "" }).pipe(
          catchError(() => of(null)),
        ),
        { defaultValue: null },
      );

      if (event) {
        // Parse relay URLs from the event using getRelaysFromList
        const relays = getRelaysFromList(event);
        if (relays.length > 0) {
          console.log(
            `[NIP-17] Found ${relays.length} DM relays for ${pubkey.slice(0, 8)}`,
          );
          this.dmRelayCache.set(pubkey, relays);
          return relays;
        }
      }

      // Fallback: Try to get inbox relays from kind 10002 (NIP-65)
      const relayListEvent = await firstValueFrom(
        addressLoader({ kind: 10002, pubkey, identifier: "" }).pipe(
          catchError(() => of(null)),
        ),
        { defaultValue: null },
      );

      if (relayListEvent) {
        // Get inbox (read) relays as fallback
        const { getInboxes } = await import("applesauce-core/helpers");
        const inboxRelays = getInboxes(relayListEvent);
        if (inboxRelays.length > 0) {
          console.log(
            `[NIP-17] Using ${inboxRelays.length} inbox relays as fallback for ${pubkey.slice(0, 8)}`,
          );
          this.dmRelayCache.set(pubkey, inboxRelays);
          return inboxRelays;
        }
      }

      // Final fallback: use aggregator relays
      console.log(
        `[NIP-17] No DM relays found for ${pubkey.slice(0, 8)}, using fallback`,
      );
      this.dmRelayCache.set(pubkey, AGGREGATOR_RELAYS);
      return AGGREGATOR_RELAYS;
    } catch (err) {
      console.error(
        `[NIP-17] Error fetching DM relays for ${pubkey.slice(0, 8)}:`,
        err,
      );
      return AGGREGATOR_RELAYS;
    }
  }

  /**
   * Get DM relays for sending to a recipient
   * Uses recipient's DM inbox relays
   */
  private async getRecipientDmRelays(
    recipientPubkey: string,
  ): Promise<string[]> {
    return this.fetchDmRelays(recipientPubkey);
  }

  /**
   * Get DM relays for receiving messages
   * Uses our own DM inbox relays
   */
  private async getOwnDmRelays(): Promise<string[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      return AGGREGATOR_RELAYS;
    }
    return this.fetchDmRelays(activePubkey);
  }

  /**
   * Load messages for a conversation
   * Subscribes to gift wraps addressed to us, decrypts them, and filters by conversation
   */
  loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const partner = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    );
    if (!partner) {
      throw new Error("No conversation partner found");
    }

    console.log(
      `[NIP-17] Loading messages for conversation with ${partner.pubkey.slice(0, 8)}...`,
    );

    // Start async process to set up subscription
    const setupSubscription = async () => {
      // Get DM relays for receiving
      const dmRelays = await this.getOwnDmRelays();

      console.log(`[NIP-17] Subscribing to ${dmRelays.length} DM relays`);

      // Subscribe to kind 1059 (gift wraps) addressed to us
      const filter: Filter = {
        kinds: [1059],
        "#p": [activePubkey],
        limit: options?.limit || 100,
      };

      if (options?.before) {
        filter.until = options.before;
      }
      if (options?.after) {
        filter.since = options.after;
      }

      // Clean up any existing subscription for this conversation
      this.cleanup(conversation.id);

      // Start a persistent subscription to DM relays
      const subscription = pool
        .subscription(dmRelays, [filter], {
          eventStore,
        })
        .subscribe({
          next: (response) => {
            if (typeof response === "string") {
              console.log("[NIP-17] EOSE received");
            } else {
              console.log(
                `[NIP-17] Received gift wrap: ${response.id.slice(0, 8)}...`,
              );
            }
          },
        });

      // Store subscription for cleanup
      this.subscriptions.set(conversation.id, subscription);
    };

    // Start subscription setup
    setupSubscription().catch((err) => {
      console.error("[NIP-17] Error setting up subscription:", err);
    });

    // Return observable from EventStore that decrypts gift wraps
    const giftWrapFilter: Filter = {
      kinds: [1059],
      "#p": [activePubkey],
    };

    return eventStore.timeline(giftWrapFilter).pipe(
      switchMap((giftWraps) => {
        // Decrypt all gift wraps and filter for this conversation
        return from(
          this.decryptAndFilterMessages(
            giftWraps,
            activePubkey,
            partner.pubkey,
            conversation.id,
          ),
        );
      }),
      map((messages) => {
        console.log(
          `[NIP-17] Decrypted ${messages.length} messages for conversation`,
        );
        // Sort by timestamp ascending
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
    );
  }

  /**
   * Decrypt gift wraps and filter messages for a specific conversation
   */
  private async decryptAndFilterMessages(
    giftWraps: NostrEvent[],
    selfPubkey: string,
    partnerPubkey: string,
    conversationId: string,
  ): Promise<Message[]> {
    const signer = accountManager.active$.value?.signer;
    if (!signer) {
      console.error("[NIP-17] No signer available for decryption");
      return [];
    }

    const messages: Message[] = [];
    const expectedParticipants = [selfPubkey, partnerPubkey].sort().join(":");

    for (const giftWrap of giftWraps) {
      try {
        let rumor: Rumor | undefined;

        // Check if already unlocked (cached)
        if (isGiftWrapUnlocked(giftWrap)) {
          rumor = getGiftWrapRumor(giftWrap);
        } else {
          // Decrypt - this will cache the result
          rumor = await unlockGiftWrap(giftWrap, signer);
        }

        if (!rumor) {
          continue;
        }

        // Only process kind 14 (NIP-17 direct messages)
        if (rumor.kind !== 14) {
          continue;
        }

        // Check if this message belongs to this conversation
        const messageParticipants = getConversationParticipants(rumor);
        const participantKey = messageParticipants.sort().join(":");

        if (participantKey !== expectedParticipants) {
          // Message is for a different conversation
          continue;
        }

        // Convert rumor to message
        const message = this.rumorToMessage(rumor, conversationId, giftWrap);
        messages.push(message);
      } catch (err) {
        // Decryption failed - might not be for us or corrupted
        console.debug(
          `[NIP-17] Failed to decrypt gift wrap ${giftWrap.id.slice(0, 8)}:`,
          err,
        );
      }
    }

    return messages;
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    const partner = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    );
    if (!partner) {
      throw new Error("No conversation partner found");
    }

    console.log(
      `[NIP-17] Loading older messages before ${before} for ${partner.pubkey.slice(0, 8)}`,
    );

    // Get DM relays
    const dmRelays = await this.getOwnDmRelays();

    // Fetch older gift wraps
    const filter: Filter = {
      kinds: [1059],
      "#p": [activePubkey],
      until: before,
      limit: 50,
    };

    const giftWraps: NostrEvent[] = [];

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log("[NIP-17] Pagination fetch timeout");
        resolve();
      }, 10000);

      const obs = pool.subscription(dmRelays, [filter], { eventStore });
      const sub = obs.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            giftWraps.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error("[NIP-17] Pagination fetch error:", err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    console.log(`[NIP-17] Fetched ${giftWraps.length} older gift wraps`);

    // Decrypt and filter
    const messages = await this.decryptAndFilterMessages(
      giftWraps,
      activePubkey,
      partner.pubkey,
      conversation.id,
    );

    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Send a message
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

    const partner = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    );
    if (!partner) {
      throw new Error("No conversation partner found");
    }

    console.log(`[NIP-17] Sending message to ${partner.pubkey.slice(0, 8)}...`);

    // Create event factory and sign
    const factory = new EventFactory();
    factory.setSigner(activeSigner);

    // Build the wrapped message rumor using applesauce blueprint
    const participants = [activePubkey, partner.pubkey];

    // Create the message rumor using factory.create with blueprint
    let rumor = await factory.create(
      WrappedMessageBlueprint,
      participants,
      content,
    );

    // Add reply tag if replying
    if (options?.replyTo) {
      rumor = {
        ...rumor,
        tags: [...rumor.tags, ["e", options.replyTo, "", "reply"]],
      };
    }

    // Add emoji tags
    if (options?.emojiTags) {
      const emojiTags = options.emojiTags.map((e) => [
        "emoji",
        e.shortcode,
        e.url,
      ]);
      rumor = {
        ...rumor,
        tags: [...rumor.tags, ...emojiTags],
      };
    }

    // Get recipient's DM relays
    const recipientRelays = await this.getRecipientDmRelays(partner.pubkey);
    const ownRelays = await this.getOwnDmRelays();

    // Send gift-wrapped copy to recipient
    const recipientGiftWrap = await factory.create(
      GiftWrapBlueprint,
      partner.pubkey,
      rumor,
    );
    const signedRecipientWrap = await factory.sign(recipientGiftWrap);

    console.log(
      `[NIP-17] Publishing to ${recipientRelays.length} recipient relays`,
    );
    await publishEventToRelays(signedRecipientWrap, recipientRelays);

    // Send gift-wrapped copy to ourselves (for syncing across devices)
    const selfGiftWrap = await factory.create(
      GiftWrapBlueprint,
      activePubkey,
      rumor,
    );
    const signedSelfWrap = await factory.sign(selfGiftWrap);

    console.log(`[NIP-17] Publishing self-copy to ${ownRelays.length} relays`);
    await publishEventToRelays(signedSelfWrap, ownRelays);

    console.log("[NIP-17] Message sent successfully");
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true,
      supportsThreading: true, // e-tag replies
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      canCreateConversations: true,
      requiresRelay: false,
    };
  }

  /**
   * Load a replied-to message
   * For NIP-17, we need to search through decrypted rumors
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      return null;
    }

    // First check if we have this event in our decrypted messages
    // The eventId for NIP-17 refers to the rumor ID, not the gift wrap ID
    const giftWrapFilter: Filter = {
      kinds: [1059],
      "#p": [activePubkey],
    };

    // Get all gift wraps from store
    const giftWraps = await firstValueFrom(
      eventStore.timeline(giftWrapFilter).pipe(first()),
      { defaultValue: [] as NostrEvent[] },
    );

    // Try to find the rumor with matching ID
    for (const giftWrap of giftWraps) {
      try {
        let rumor: Rumor | undefined;

        if (isGiftWrapUnlocked(giftWrap)) {
          rumor = getGiftWrapRumor(giftWrap);
        } else {
          rumor = await unlockGiftWrap(giftWrap, activeSigner);
        }

        if (rumor && rumor.id === eventId) {
          // Found it - return as NostrEvent (rumors are structurally similar)
          return rumor as unknown as NostrEvent;
        }
      } catch {
        // Decryption failed, continue
      }
    }

    console.log(
      `[NIP-17] Reply message ${eventId.slice(0, 8)} not found in decrypted messages`,
    );
    return null;
  }

  /**
   * Helper: Convert Rumor to Message
   */
  private rumorToMessage(
    rumor: Rumor,
    conversationId: string,
    giftWrap: NostrEvent,
  ): Message {
    const sender = getWrappedMessageSender(rumor);
    const replyTo = getWrappedMessageParent(rumor);

    // Also check for e-tag replies
    const eTags = getTagValues(rumor as unknown as NostrEvent, "e");
    const eTagReply = eTags.find((_, i, arr) => {
      // Look for e-tag with "reply" marker
      const tag = rumor.tags.find(
        (t) => t[0] === "e" && t[1] === arr[i] && t[3] === "reply",
      );
      return !!tag;
    });

    return {
      id: rumor.id,
      conversationId,
      author: sender,
      content: rumor.content,
      timestamp: rumor.created_at,
      type: "user",
      replyTo: replyTo || eTagReply,
      protocol: "nip-17",
      metadata: {
        encrypted: true,
      },
      // Store the gift wrap as the "event" for reference
      // (the actual rumor is unsigned so we reference the wrapper)
      event: giftWrap,
    };
  }

  /**
   * Helper: Get user metadata
   */
  private async getMetadata(pubkey: string): Promise<NostrEvent | undefined> {
    return firstValueFrom(eventStore.replaceable(0, pubkey), {
      defaultValue: undefined,
    });
  }
}
