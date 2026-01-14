/**
 * NIP-17 Adapter - Private Direct Messages (Gift Wrapped)
 *
 * Implements NIP-17 encrypted DMs using NIP-59 gift wraps:
 * - kind 1059: Gift wrap (outer encrypted layer with ephemeral key)
 * - kind 13: Seal (middle layer encrypted with sender's key)
 * - kind 14: DM rumor (inner content - the actual message)
 *
 * Privacy features:
 * - Sender identity hidden (ephemeral gift wrap key)
 * - Deniability (rumors are unsigned)
 * - Uses recipient's private inbox relays (kind 10050)
 *
 * Caching:
 * - Gift wraps are cached to Dexie events table
 * - Decrypted content persisted via applesauce's persistEncryptedContent
 */
import { Observable, firstValueFrom, BehaviorSubject } from "rxjs";
import { map, first, distinctUntilChanged } from "rxjs/operators";
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
import accountManager from "@/services/accounts";
import { hub } from "@/services/hub";
import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { isNip05, resolveNip05 } from "@/lib/nip05";
import { getDisplayName } from "@/lib/nostr-utils";
import { isValidHexPubkey } from "@/lib/nostr-validation";
import { getProfileContent } from "applesauce-core/helpers";
import {
  unlockGiftWrap,
  isGiftWrapUnlocked,
  getGiftWrapRumor,
  getConversationParticipants,
  getConversationIdentifierFromMessage,
  type Rumor,
} from "applesauce-common/helpers";
import { SendWrappedMessage } from "applesauce-actions/actions";

/**
 * Kind constants
 */
const GIFT_WRAP_KIND = 1059;
const DM_RUMOR_KIND = 14;
const DM_RELAY_LIST_KIND = 10050;

/**
 * NIP-17 Adapter - Gift Wrapped Private DMs
 */
export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /** Track pending (undecrypted) gift wrap IDs */
  private pendingGiftWraps$ = new BehaviorSubject<Set<string>>(new Set());

  /** Observable of gift wrap events from event store */
  private giftWraps$ = new BehaviorSubject<NostrEvent[]>([]);

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
    let partnerPubkey: string;

    // Resolve NIP-05 if needed
    if (identifier.type === "chat-partner-nip05") {
      const resolved = await resolveNip05(identifier.value);
      if (!resolved) {
        throw new Error(`Failed to resolve NIP-05: ${identifier.value}`);
      }
      partnerPubkey = resolved;
    } else if (
      identifier.type === "dm-recipient" ||
      identifier.type === "chat-partner"
    ) {
      partnerPubkey = identifier.value;
    } else {
      throw new Error(
        `NIP-17 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    // Get display name for partner
    const metadataEvent = await this.getMetadata(partnerPubkey);
    const metadata = metadataEvent
      ? getProfileContent(metadataEvent)
      : undefined;
    const title = getDisplayName(partnerPubkey, metadata);

    // Create conversation ID from sorted participants (deterministic)
    const participants = [activePubkey, partnerPubkey].sort();
    const conversationId = `nip-17:${participants.join(",")}`;

    return {
      id: conversationId,
      type: "dm",
      protocol: "nip-17",
      title,
      participants: [
        { pubkey: activePubkey, role: "member" },
        { pubkey: partnerPubkey, role: "member" },
      ],
      metadata: {
        encrypted: true,
        giftWrapped: true,
      },
      unreadCount: 0,
    };
  }

  /**
   * Load messages for a conversation
   * Returns decrypted rumors that match this conversation
   */
  loadMessages(
    conversation: Conversation,
    _options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    // Get partner pubkey
    const partner = conversation.participants.find(
      (p) => p.pubkey !== activePubkey,
    );
    if (!partner) {
      throw new Error("No conversation partner found");
    }

    // Expected participants for this conversation
    const expectedParticipants = [activePubkey, partner.pubkey].sort();

    // Subscribe to gift wraps for this user
    this.subscribeToGiftWraps(activePubkey);

    // Get rumors from unlocked gift wraps and filter to this conversation
    return this.giftWraps$.pipe(
      map((giftWraps) => {
        const messages: Message[] = [];

        for (const gift of giftWraps) {
          // Skip locked gift wraps
          if (!isGiftWrapUnlocked(gift)) continue;

          try {
            const rumor = getGiftWrapRumor(gift);

            // Only kind 14 DM rumors
            if (rumor.kind !== DM_RUMOR_KIND) continue;

            // Get participants from rumor
            const rumorParticipants = getConversationParticipants(rumor).sort();

            // Check if participants match this conversation
            if (
              rumorParticipants.length !== expectedParticipants.length ||
              !rumorParticipants.every((p, i) => p === expectedParticipants[i])
            ) {
              continue;
            }

            messages.push(this.rumorToMessage(rumor, conversation.id));
          } catch (error) {
            console.warn(
              `[NIP-17] Failed to get rumor from gift wrap ${gift.id}:`,
              error,
            );
          }
        }

        // Sort by timestamp
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((m, i) => m.id === b[i].id),
      ),
    );
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    // Gift wraps don't paginate well since we need to decrypt all
    return [];
  }

  /**
   * Send a gift-wrapped DM
   *
   * Uses applesauce's SendWrappedMessage action which:
   * 1. Creates kind 14 rumor with message content
   * 2. Wraps in seal (kind 13) encrypted to each participant
   * 3. Wraps seal in gift wrap (kind 1059) with ephemeral key
   * 4. Publishes to each participant's private inbox relays (kind 10050)
   */
  async sendMessage(
    conversation: Conversation,
    content: string,
    _options?: SendMessageOptions,
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

    // Use applesauce's SendWrappedMessage action
    // This handles:
    // - Creating the wrapped message rumor
    // - Gift wrapping for all participants (partner + self)
    // - Publishing to each participant's inbox relays
    await hub.run(SendWrappedMessage, partner.pubkey, content);

    console.log(
      `[NIP-17] Sent wrapped message to ${partner.pubkey.slice(0, 8)}...`,
    );
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
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // Check if we have an unlocked gift wrap with a rumor matching this ID
    const giftWraps = this.giftWraps$.value;

    for (const gift of giftWraps) {
      if (!isGiftWrapUnlocked(gift)) continue;

      try {
        const rumor = getGiftWrapRumor(gift);
        if (rumor.id === eventId) {
          // Return as pseudo-event
          return {
            ...rumor,
            sig: "",
          } as NostrEvent;
        }
      } catch {
        // Skip
      }
    }

    return null;
  }

  /**
   * Get count of pending (undecrypted) gift wraps
   */
  getPendingCount(): number {
    return this.pendingGiftWraps$.value.size;
  }

  /**
   * Get observable of pending gift wrap count
   */
  getPendingCount$(): Observable<number> {
    return this.pendingGiftWraps$.pipe(map((set) => set.size));
  }

  /**
   * Decrypt all pending gift wraps
   */
  async decryptPending(): Promise<{ success: number; failed: number }> {
    const signer = accountManager.active$.value?.signer;
    const pubkey = accountManager.active$.value?.pubkey;

    if (!signer || !pubkey) {
      throw new Error("No active account");
    }

    const pendingIds = Array.from(this.pendingGiftWraps$.value);
    let success = 0;
    let failed = 0;

    for (const giftWrapId of pendingIds) {
      try {
        // Get the gift wrap event
        const giftWrap = await firstValueFrom(
          eventStore.event(giftWrapId).pipe(first()),
        );

        if (!giftWrap) {
          failed++;
          continue;
        }

        // Already unlocked?
        if (isGiftWrapUnlocked(giftWrap)) {
          // Remove from pending
          const pending = new Set(this.pendingGiftWraps$.value);
          pending.delete(giftWrapId);
          this.pendingGiftWraps$.next(pending);
          success++;
          continue;
        }

        // Decrypt using signer - applesauce handles caching automatically
        await unlockGiftWrap(giftWrap, signer);

        // Remove from pending
        const pending = new Set(this.pendingGiftWraps$.value);
        pending.delete(giftWrapId);
        this.pendingGiftWraps$.next(pending);

        // Refresh gift wraps list
        this.giftWraps$.next([...this.giftWraps$.value]);

        success++;
      } catch (error) {
        console.error(
          `[NIP-17] Failed to decrypt gift wrap ${giftWrapId}:`,
          error,
        );
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * Get all conversations from decrypted rumors
   */
  getConversations$(): Observable<Conversation[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      return new BehaviorSubject([]);
    }

    // Start fetching gift wraps from inbox relays
    this.subscribeToGiftWraps(activePubkey);

    return this.giftWraps$.pipe(
      map((giftWraps) => {
        // Group rumors by conversation
        const conversationMap = new Map<
          string,
          { participants: string[]; lastRumor: Rumor }
        >();

        for (const gift of giftWraps) {
          if (!isGiftWrapUnlocked(gift)) continue;

          try {
            const rumor = getGiftWrapRumor(gift);
            if (rumor.kind !== DM_RUMOR_KIND) continue;

            const convId = getConversationIdentifierFromMessage(rumor);
            const participants = getConversationParticipants(rumor);

            const existing = conversationMap.get(convId);
            if (!existing || rumor.created_at > existing.lastRumor.created_at) {
              conversationMap.set(convId, { participants, lastRumor: rumor });
            }
          } catch {
            // Skip invalid gift wraps
          }
        }

        // Convert to Conversation objects
        const conversations: Conversation[] = [];

        for (const [convId, { participants, lastRumor }] of conversationMap) {
          const partner = participants.find((p) => p !== activePubkey);
          if (!partner) continue;

          conversations.push({
            id: `nip-17:${participants.sort().join(",")}`,
            type: "dm",
            protocol: "nip-17",
            title: partner.slice(0, 8) + "...", // Will be replaced with display name
            participants: participants.map((p) => ({
              pubkey: p,
              role: "member" as const,
            })),
            metadata: { encrypted: true, giftWrapped: true },
            lastMessage: this.rumorToMessage(lastRumor, convId),
            unreadCount: 0,
          });
        }

        // Sort by last message timestamp
        conversations.sort(
          (a, b) =>
            (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0),
        );

        return conversations;
      }),
    );
  }

  // ==================== Private Methods ====================

  /**
   * Subscribe to gift wraps for the user from their inbox relays
   */
  private async subscribeToGiftWraps(pubkey: string): Promise<void> {
    const conversationId = `nip-17:inbox:${pubkey}`;

    // Clean up existing subscription
    this.cleanup(conversationId);

    // Get user's private inbox relays (kind 10050)
    const inboxRelays = await this.getInboxRelays(pubkey);
    if (inboxRelays.length === 0) {
      console.warn(
        "[NIP-17] No inbox relays found. Configure kind 10050 to receive DMs.",
      );
      return;
    }

    console.log(
      `[NIP-17] Subscribing to ${inboxRelays.length} inbox relays:`,
      inboxRelays,
    );

    // Subscribe to gift wraps addressed to this user
    const filter: Filter = {
      kinds: [GIFT_WRAP_KIND],
      "#p": [pubkey],
    };

    const subscription = pool
      .subscription(inboxRelays, [filter], { eventStore })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE
            console.log("[NIP-17] EOSE received for gift wraps");
          } else {
            // New gift wrap received
            console.log(
              `[NIP-17] Received gift wrap: ${response.id.slice(0, 8)}...`,
            );

            // Add to gift wraps list
            const current = this.giftWraps$.value;
            if (!current.find((g) => g.id === response.id)) {
              this.giftWraps$.next([...current, response]);
            }

            // Check if unlocked (cached) or pending
            if (!isGiftWrapUnlocked(response)) {
              const pending = new Set(this.pendingGiftWraps$.value);
              pending.add(response.id);
              this.pendingGiftWraps$.next(pending);
            }
          }
        },
      });

    this.subscriptions.set(conversationId, subscription);
  }

  /**
   * Get private inbox relays for a user (kind 10050)
   */
  private async getInboxRelays(pubkey: string): Promise<string[]> {
    // Try to fetch from EventStore first
    const existing = await firstValueFrom(
      eventStore.replaceable(DM_RELAY_LIST_KIND, pubkey, ""),
      { defaultValue: undefined },
    );

    if (existing) {
      const relays = this.extractRelaysFromEvent(existing);
      if (relays.length > 0) {
        console.log(
          `[NIP-17] Found inbox relays in store for ${pubkey.slice(0, 8)}:`,
          relays,
        );
        return relays;
      }
    }

    // Get user's outbox relays to search for their kind 10050
    const outboxRelays = await relayListCache.getOutboxRelays(pubkey);
    const searchRelays =
      outboxRelays && outboxRelays.length > 0
        ? outboxRelays
        : AGGREGATOR_RELAYS;

    if (searchRelays.length === 0) {
      console.warn(
        `[NIP-17] No relays to search for kind 10050 for ${pubkey.slice(0, 8)}`,
      );
      return [];
    }

    console.log(
      `[NIP-17] Searching ${searchRelays.length} relays for kind 10050:`,
      searchRelays,
    );

    // Fetch from user's outbox relays
    const filter: Filter = {
      kinds: [DM_RELAY_LIST_KIND],
      authors: [pubkey],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      const sub = pool
        .subscription(searchRelays, [filter], { eventStore })
        .subscribe({
          next: (response) => {
            if (typeof response === "string") {
              clearTimeout(timeout);
              sub.unsubscribe();
              resolve();
            } else {
              events.push(response);
            }
          },
          error: () => {
            clearTimeout(timeout);
            resolve();
          },
        });
    });

    if (events.length > 0) {
      const relays = this.extractRelaysFromEvent(events[0]);
      console.log(
        `[NIP-17] Found inbox relays from network for ${pubkey.slice(0, 8)}:`,
        relays,
      );
      return relays;
    }

    return [];
  }

  /**
   * Extract relay URLs from kind 10050 event
   */
  private extractRelaysFromEvent(event: NostrEvent): string[] {
    return event.tags.filter((t) => t[0] === "relay" && t[1]).map((t) => t[1]);
  }

  /**
   * Convert a rumor to a Message
   */
  private rumorToMessage(rumor: Rumor, conversationId: string): Message {
    // Check for reply reference
    const replyTag = rumor.tags.find(
      (t) => t[0] === "e" && (t[3] === "reply" || !t[3]),
    );
    const replyTo = replyTag?.[1];

    return {
      id: rumor.id,
      conversationId,
      author: rumor.pubkey,
      content: rumor.content,
      timestamp: rumor.created_at,
      type: "user",
      replyTo,
      protocol: "nip-17",
      metadata: {
        encrypted: true,
      },
      // Create a pseudo-event for the rumor (unsigned)
      event: {
        ...rumor,
        sig: "",
      } as NostrEvent,
    };
  }

  /**
   * Get metadata for a pubkey
   */
  private async getMetadata(pubkey: string): Promise<NostrEvent | undefined> {
    return firstValueFrom(eventStore.replaceable(0, pubkey), {
      defaultValue: undefined,
    });
  }
}
