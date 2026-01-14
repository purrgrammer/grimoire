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
import { getEventsForFilters } from "@/services/event-cache";
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

  /** Track failed (could not decrypt) gift wrap IDs */
  private failedGiftWraps$ = new BehaviorSubject<Set<string>>(new Set());

  /** Observable of gift wrap events from event store */
  private giftWraps$ = new BehaviorSubject<NostrEvent[]>([]);

  /** Track if subscription is active */
  private subscriptionActive = false;

  /**
   * Parse identifier - accepts npub, nprofile, hex pubkey, NIP-05, or $me
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Handle $me alias for saved messages (DMs to yourself)
    if (input.toLowerCase() === "$me") {
      return {
        type: "dm-self",
        value: "$me",
      };
    }

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
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    let partnerPubkey: string;

    // Handle $me (saved messages - DMs to yourself)
    if (identifier.type === "dm-self") {
      partnerPubkey = activePubkey;
    } else if (identifier.type === "chat-partner-nip05") {
      // Resolve NIP-05
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

    // Check if this is a self-conversation (saved messages)
    const isSelf = partnerPubkey === activePubkey;
    const title = isSelf
      ? "Saved Messages"
      : await this.getPartnerTitle(partnerPubkey);

    // Create conversation ID from sorted participants (deterministic)
    // For self-conversations, it's just one participant listed twice
    const participants = isSelf
      ? [activePubkey]
      : [activePubkey, partnerPubkey].sort();
    const conversationId = `nip-17:${participants.join(",")}`;

    return {
      id: conversationId,
      type: "dm",
      protocol: "nip-17",
      title,
      participants: isSelf
        ? [{ pubkey: activePubkey, role: "member" }]
        : [
            { pubkey: activePubkey, role: "member" },
            { pubkey: partnerPubkey, role: "member" },
          ],
      metadata: {
        encrypted: true,
        giftWrapped: true,
        isSavedMessages: isSelf,
      },
      unreadCount: 0,
    };
  }

  /**
   * Get display name for a partner pubkey
   */
  private async getPartnerTitle(pubkey: string): Promise<string> {
    const metadataEvent = await this.getMetadata(pubkey);
    const metadata = metadataEvent
      ? getProfileContent(metadataEvent)
      : undefined;
    return getDisplayName(pubkey, metadata);
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

    // Check if this is a self-conversation (saved messages)
    const isSelfConversation =
      conversation.metadata?.isSavedMessages ||
      (conversation.participants.length === 1 &&
        conversation.participants[0].pubkey === activePubkey);

    // Get partner pubkey (for self-conversation, partner is self)
    const partnerPubkey = isSelfConversation
      ? activePubkey
      : conversation.participants.find((p) => p.pubkey !== activePubkey)
          ?.pubkey;

    if (!partnerPubkey) {
      throw new Error("No conversation partner found");
    }

    // Expected participants for this conversation
    // For self-conversations, both sender and recipient are the same
    const expectedParticipants = isSelfConversation
      ? [activePubkey]
      : [activePubkey, partnerPubkey].sort();

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
            const rumorParticipants = getConversationParticipants(rumor);

            // For self-conversations, all participants should be the same (sender == recipient)
            if (isSelfConversation) {
              // Check if all participants are the same as activePubkey
              const allSelf = rumorParticipants.every(
                (p) => p === activePubkey,
              );
              if (!allSelf) continue;
            } else {
              // Check if participants match this conversation
              const sortedRumorParticipants = rumorParticipants.sort();
              if (
                sortedRumorParticipants.length !==
                  expectedParticipants.length ||
                !sortedRumorParticipants.every(
                  (p, i) => p === expectedParticipants[i],
                )
              ) {
                continue;
              }
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

    // Check if this is a self-conversation (saved messages)
    const isSelfConversation =
      conversation.metadata?.isSavedMessages ||
      (conversation.participants.length === 1 &&
        conversation.participants[0].pubkey === activePubkey);

    // Get recipient pubkey (for self-conversation, it's ourselves)
    const recipientPubkey = isSelfConversation
      ? activePubkey
      : conversation.participants.find((p) => p.pubkey !== activePubkey)
          ?.pubkey;

    if (!recipientPubkey) {
      throw new Error("No conversation recipient found");
    }

    // Use applesauce's SendWrappedMessage action
    // This handles:
    // - Creating the wrapped message rumor
    // - Gift wrapping for all participants (recipient + self)
    // - Publishing to each participant's inbox relays
    await hub.run(SendWrappedMessage, recipientPubkey, content);

    console.log(
      `[NIP-17] Sent wrapped message to ${recipientPubkey.slice(0, 8)}...${isSelfConversation ? " (saved)" : ""}`,
    );

    // Note: The sent gift wrap will be picked up automatically via eventStore.insert$ subscription
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
   * Get count of pending (undecrypted) gift wraps (excludes failed)
   */
  getPendingCount(): number {
    const pending = this.pendingGiftWraps$.value;
    const failed = this.failedGiftWraps$.value;
    // Only count pending that haven't failed
    return Array.from(pending).filter((id) => !failed.has(id)).length;
  }

  /**
   * Get observable of pending gift wrap count (excludes failed)
   */
  getPendingCount$(): Observable<number> {
    return this.pendingGiftWraps$.pipe(
      map((pending) => {
        const failed = this.failedGiftWraps$.value;
        return Array.from(pending).filter((id) => !failed.has(id)).length;
      }),
    );
  }

  /**
   * Get count of failed gift wraps
   */
  getFailedCount(): number {
    return this.failedGiftWraps$.value.size;
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

    // Only try pending that haven't already failed
    const failedSet = this.failedGiftWraps$.value;
    const pendingIds = Array.from(this.pendingGiftWraps$.value).filter(
      (id) => !failedSet.has(id),
    );
    let success = 0;
    let failed = 0;

    for (const giftWrapId of pendingIds) {
      try {
        // Get the gift wrap event
        const giftWrap = await firstValueFrom(
          eventStore.event(giftWrapId).pipe(first()),
        );

        if (!giftWrap) {
          // Mark as failed - couldn't find the event
          this.markAsFailed(giftWrapId);
          failed++;
          continue;
        }

        // Already unlocked?
        if (isGiftWrapUnlocked(giftWrap)) {
          // Remove from pending
          this.removeFromPending(giftWrapId);
          success++;
          continue;
        }

        // Decrypt using signer - applesauce handles caching automatically
        await unlockGiftWrap(giftWrap, signer);

        // Remove from pending (success)
        this.removeFromPending(giftWrapId);

        // Refresh gift wraps list
        this.giftWraps$.next([...this.giftWraps$.value]);

        success++;
      } catch (error) {
        console.error(
          `[NIP-17] Failed to decrypt gift wrap ${giftWrapId}:`,
          error,
        );
        // Mark as failed so we don't retry
        this.markAsFailed(giftWrapId);
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * Mark a gift wrap as failed (won't retry decryption)
   */
  private markAsFailed(giftWrapId: string): void {
    const failed = new Set(this.failedGiftWraps$.value);
    failed.add(giftWrapId);
    this.failedGiftWraps$.next(failed);
  }

  /**
   * Remove a gift wrap from pending
   */
  private removeFromPending(giftWrapId: string): void {
    const pending = new Set(this.pendingGiftWraps$.value);
    pending.delete(giftWrapId);
    this.pendingGiftWraps$.next(pending);
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
          // Check if this is a self-conversation (all participants are activePubkey)
          const isSelfConversation = participants.every(
            (p) => p === activePubkey,
          );

          // Get partner pubkey (for self-conversation, use self)
          const partnerPubkey = isSelfConversation
            ? activePubkey
            : participants.find((p) => p !== activePubkey);

          // Skip if we can't determine partner (shouldn't happen)
          if (!partnerPubkey) continue;

          // Create unique participant list for conversation ID
          const uniqueParticipants = isSelfConversation
            ? [activePubkey]
            : participants.sort();

          conversations.push({
            id: `nip-17:${uniqueParticipants.join(",")}`,
            type: "dm",
            protocol: "nip-17",
            title: isSelfConversation
              ? "Saved Messages"
              : partnerPubkey.slice(0, 8) + "...", // Will be replaced with display name
            participants: isSelfConversation
              ? [{ pubkey: activePubkey, role: "member" as const }]
              : participants.map((p) => ({
                  pubkey: p,
                  role: "member" as const,
                })),
            metadata: {
              encrypted: true,
              giftWrapped: true,
              isSavedMessages: isSelfConversation,
            },
            lastMessage: this.rumorToMessage(lastRumor, convId),
            unreadCount: 0,
          });
        }

        // Sort: Saved Messages at top, then by last message timestamp
        conversations.sort((a, b) => {
          // Saved Messages always first
          if (a.metadata?.isSavedMessages && !b.metadata?.isSavedMessages)
            return -1;
          if (!a.metadata?.isSavedMessages && b.metadata?.isSavedMessages)
            return 1;
          // Then by timestamp
          return (
            (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)
          );
        });

        return conversations;
      }),
    );
  }

  // ==================== Public Methods for Subscription Management ====================

  /**
   * Ensure gift wrap subscription is active for the current user
   * Call this when InboxViewer or ChatViewer mounts
   */
  ensureSubscription(): void {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      console.warn("[NIP-17] Cannot start subscription: no active account");
      return;
    }

    if (!this.subscriptionActive) {
      console.log("[NIP-17] Starting gift wrap subscription");
      this.subscribeToGiftWraps(activePubkey);
    }
  }

  /**
   * Check if subscription is currently active
   */
  isSubscriptionActive(): boolean {
    return this.subscriptionActive;
  }

  // ==================== Private Methods ====================

  /**
   * Subscribe to gift wraps for the user from their inbox relays
   * Also subscribes to eventStore.insert$ to catch locally published gift wraps
   */
  private async subscribeToGiftWraps(pubkey: string): Promise<void> {
    // Don't create duplicate subscriptions
    if (this.subscriptionActive) {
      console.log("[NIP-17] Subscription already active, skipping");
      return;
    }

    this.subscriptionActive = true;

    // First, load any cached gift wraps from EventStore (persisted to Dexie)
    // This is critical for cold start scenarios
    await this.loadCachedGiftWraps(pubkey);

    // Subscribe to eventStore.insert$ to catch gift wraps added locally (e.g., after sending)
    // This is critical for immediate display of sent messages
    const insertSub = eventStore.insert$.subscribe((event) => {
      if (
        event.kind === GIFT_WRAP_KIND &&
        event.tags.some((t) => t[0] === "p" && t[1] === pubkey)
      ) {
        console.log(
          `[NIP-17] Detected gift wrap from eventStore.insert$: ${event.id.slice(0, 8)}...`,
        );
        this.handleGiftWrap(event);
      }
    });
    this.subscriptions.set(`nip-17:insert:${pubkey}`, insertSub);

    const conversationId = `nip-17:inbox:${pubkey}`;

    // Get user's private inbox relays (kind 10050)
    const inboxRelays = await this.fetchInboxRelays(pubkey);
    if (inboxRelays.length === 0) {
      console.warn(
        "[NIP-17] No inbox relays found. Configure kind 10050 to receive DMs.",
      );
      // Still keep subscriptionActive true for insert$ subscription
      return;
    }

    console.log(
      `[NIP-17] Subscribing to ${inboxRelays.length} inbox relays:`,
      inboxRelays,
    );

    // Subscribe to gift wraps addressed to this user from relays
    const filter: Filter = {
      kinds: [GIFT_WRAP_KIND],
      "#p": [pubkey],
    };

    const relaySub = pool
      .subscription(inboxRelays, [filter], { eventStore })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE
            console.log("[NIP-17] EOSE received for gift wraps");
          } else {
            // New gift wrap received from relay
            console.log(
              `[NIP-17] Received gift wrap from relay: ${response.id.slice(0, 8)}...`,
            );
            this.handleGiftWrap(response);
          }
        },
        error: (err) => {
          console.error("[NIP-17] Relay subscription error:", err);
        },
        complete: () => {
          console.log("[NIP-17] Relay subscription completed");
        },
      });

    this.subscriptions.set(conversationId, relaySub);
  }

  /**
   * Load cached gift wraps from Dexie (persistent storage)
   * This is called on cold start to restore previously received gift wraps
   * We query Dexie directly because EventStore is in-memory and empty on cold start
   */
  private async loadCachedGiftWraps(pubkey: string): Promise<void> {
    try {
      // Query Dexie directly for cached gift wraps addressed to this user
      // EventStore is in-memory only, so on cold start it's empty
      const cachedGiftWraps = await getEventsForFilters([
        { kinds: [GIFT_WRAP_KIND], "#p": [pubkey] },
      ]);

      if (cachedGiftWraps.length > 0) {
        console.log(
          `[NIP-17] Loading ${cachedGiftWraps.length} cached gift wrap(s) from Dexie`,
        );
        for (const giftWrap of cachedGiftWraps) {
          // Add to EventStore so other parts of the app can access it
          eventStore.add(giftWrap);
          // Handle in adapter state
          this.handleGiftWrap(giftWrap);
        }
      } else {
        console.log("[NIP-17] No cached gift wraps found in Dexie");
      }
    } catch (error) {
      console.warn("[NIP-17] Failed to load cached gift wraps:", error);
    }
  }

  /**
   * Handle a received or sent gift wrap
   */
  private handleGiftWrap(giftWrap: NostrEvent): void {
    // Add to gift wraps list if not already present
    const current = this.giftWraps$.value;
    if (!current.find((g) => g.id === giftWrap.id)) {
      this.giftWraps$.next([...current, giftWrap]);
    }

    // Check if unlocked (cached) or pending (skip if already failed)
    if (!isGiftWrapUnlocked(giftWrap)) {
      if (!this.failedGiftWraps$.value.has(giftWrap.id)) {
        const pending = new Set(this.pendingGiftWraps$.value);
        pending.add(giftWrap.id);
        this.pendingGiftWraps$.next(pending);
      }
    }
  }

  /** Cache for inbox relays */
  private inboxRelayCache = new Map<string, string[]>();

  /**
   * Get inbox relays for a user (public API for UI display)
   * Returns cached value or fetches from network
   */
  async getInboxRelays(pubkey: string): Promise<string[]> {
    const cached = this.inboxRelayCache.get(pubkey);
    if (cached) return cached;

    const relays = await this.fetchInboxRelays(pubkey);
    if (relays.length > 0) {
      this.inboxRelayCache.set(pubkey, relays);
    }
    return relays;
  }

  /**
   * Fetch private inbox relays for a user (kind 10050)
   */
  private async fetchInboxRelays(pubkey: string): Promise<string[]> {
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

  /**
   * Add a gift wrap event directly to local state
   * Used for optimistic updates after sending
   */
  addGiftWrapLocally(giftWrap: NostrEvent): void {
    const current = this.giftWraps$.value;
    if (!current.find((g) => g.id === giftWrap.id)) {
      this.giftWraps$.next([...current, giftWrap]);
    }
  }
}

/**
 * Singleton instance for shared state across the app
 * All components should use this to ensure gift wraps are shared
 */
export const nip17Adapter = new Nip17Adapter();
