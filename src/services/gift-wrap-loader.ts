/**
 * NIP-59 Gift Wrap Loader Service
 *
 * Loads gift wraps (kind 1059) from user's inbox relays and processes them.
 * Gift wraps are private messages wrapped in multiple layers of encryption.
 *
 * Architecture:
 * - Fetches from inbox relays (NIP-65 read relays)
 * - Requires NIP-42 AUTH for relay access
 * - Caches decryption results to avoid re-processing
 * - Updates conversation metadata for UI
 *
 * See: https://github.com/nostr-protocol/nips/blob/master/59.md
 */

import { BehaviorSubject, Observable } from "rxjs";
import type { NostrEvent } from "@/types/nostr";
import type { Signer } from "applesauce-signers";
import pool from "./relay-pool";
import eventStore from "./event-store";
import { relayListCache } from "./relay-list-cache";
import { processGiftWrap, getPendingGiftWraps } from "./gift-wrap";
import db from "./db";

/**
 * Gift wrap loader state
 */
interface GiftWrapLoaderState {
  enabled: boolean;
  loading: boolean;
  recipientPubkey?: string;
  lastSync?: number;
  errorCount: number;
}

/**
 * Gift wrap loader service
 * Manages loading and processing of gift wraps for the active account
 */
class GiftWrapLoader {
  private state$ = new BehaviorSubject<GiftWrapLoaderState>({
    enabled: false,
    loading: false,
    errorCount: 0,
  });

  private subscription?: { unsubscribe: () => void };
  private currentSigner?: Signer;

  /**
   * Observable state of the loader
   */
  get state(): Observable<GiftWrapLoaderState> {
    return this.state$.asObservable();
  }

  /**
   * Gets current state
   */
  getCurrentState(): GiftWrapLoaderState {
    return this.state$.value;
  }

  /**
   * Enables gift wrap loading for a user
   *
   * @param recipientPubkey - The user's public key
   * @param signer - The user's signer (for decryption)
   */
  async enable(recipientPubkey: string, signer: Signer): Promise<void> {
    // Stop any existing subscription
    this.disable();

    this.currentSigner = signer;

    this.state$.next({
      ...this.state$.value,
      enabled: true,
      recipientPubkey,
    });

    console.log(`[GiftWrapLoader] Enabled for ${recipientPubkey.slice(0, 8)}`);

    // Start loading
    await this.sync();
  }

  /**
   * Disables gift wrap loading
   */
  disable(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }

    this.currentSigner = undefined;

    this.state$.next({
      ...this.state$.value,
      enabled: false,
      loading: false,
      recipientPubkey: undefined,
    });

    console.log("[GiftWrapLoader] Disabled");
  }

  /**
   * Syncs gift wraps from inbox relays
   */
  async sync(): Promise<void> {
    const state = this.state$.value;

    if (!state.enabled || !state.recipientPubkey || !this.currentSigner) {
      console.warn("[GiftWrapLoader] Cannot sync: not enabled or no signer");
      return;
    }

    if (state.loading) {
      console.log("[GiftWrapLoader] Already syncing, skipping");
      return;
    }

    this.state$.next({ ...state, loading: true });

    try {
      // Get inbox relays from cache
      const inboxRelays = await this.getInboxRelays(state.recipientPubkey);

      if (inboxRelays.length === 0) {
        console.warn(
          "[GiftWrapLoader] No inbox relays found, using aggregator relays",
        );
        // Could fall back to aggregator relays, but gift wraps are typically private
        // so this might not work well
      }

      console.log(
        `[GiftWrapLoader] Syncing from ${inboxRelays.length} inbox relays`,
      );

      // Subscribe to kind 1059 events for this user
      const filter = {
        kinds: [1059],
        "#p": [state.recipientPubkey],
        // Optionally add since: to only get new messages
        // since: state.lastSync ? Math.floor(state.lastSync / 1000) : undefined,
      };

      // Store subscription for cleanup
      this.subscription = pool.subscribe(inboxRelays, [filter], {
        onevent: async (event: NostrEvent) => {
          await this.handleGiftWrap(event);
        },
        oneose: () => {
          console.log("[GiftWrapLoader] EOSE received");
          this.state$.next({
            ...this.state$.value,
            loading: false,
            lastSync: Date.now(),
          });
        },
        onclose: (reason: string) => {
          console.log(`[GiftWrapLoader] Subscription closed: ${reason}`);
          this.state$.next({
            ...this.state$.value,
            loading: false,
          });
        },
      });

      // Process any pending gift wraps from database
      await this.processPendingGiftWraps();
    } catch (error) {
      console.error("[GiftWrapLoader] Sync error:", error);
      this.state$.next({
        ...this.state$.value,
        loading: false,
        errorCount: state.errorCount + 1,
      });
    }
  }

  /**
   * Handles a received gift wrap event
   */
  private async handleGiftWrap(event: NostrEvent): Promise<void> {
    const state = this.state$.value;

    if (!state.recipientPubkey || !this.currentSigner) {
      return;
    }

    try {
      // Add to event store for tracking
      eventStore.add(event);

      // Process (unwrap, unseal, cache)
      await processGiftWrap(event, state.recipientPubkey, this.currentSigner);

      console.log(
        `[GiftWrapLoader] Processed gift wrap ${event.id.slice(0, 8)}`,
      );
    } catch (error) {
      console.error(
        `[GiftWrapLoader] Failed to handle gift wrap ${event.id.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Processes pending gift wraps from database
   * (Gift wraps that were received but not yet decrypted)
   */
  private async processPendingGiftWraps(): Promise<void> {
    const state = this.state$.value;

    if (!state.recipientPubkey || !this.currentSigner) {
      return;
    }

    const pending = await getPendingGiftWraps(state.recipientPubkey);

    if (pending.length === 0) {
      return;
    }

    console.log(
      `[GiftWrapLoader] Processing ${pending.length} pending gift wraps`,
    );

    for (const envelope of pending) {
      try {
        await processGiftWrap(
          envelope.event,
          state.recipientPubkey,
          this.currentSigner,
        );
      } catch (error) {
        console.error(
          `[GiftWrapLoader] Failed to process pending gift wrap ${envelope.id.slice(0, 8)}:`,
          error,
        );
      }
    }
  }

  /**
   * Gets inbox relays for a user
   */
  private async getInboxRelays(pubkey: string): Promise<string[]> {
    // Try cache first
    let relays = await relayListCache.getInboxRelays(pubkey);

    if (!relays || relays.length === 0) {
      // Try to get from event store
      const event = eventStore.getReplaceable(10002, pubkey, "");
      if (event) {
        // Cache it
        relayListCache.set(event);
        relays = await relayListCache.getInboxRelays(pubkey);
      }
    }

    return relays || [];
  }

  /**
   * Forces a full resync (re-fetches all gift wraps)
   */
  async forceSync(): Promise<void> {
    // Clear lastSync to fetch all messages
    this.state$.next({
      ...this.state$.value,
      lastSync: undefined,
    });

    await this.sync();
  }

  /**
   * Gets count of unread messages
   */
  async getUnreadCount(recipientPubkey: string): Promise<number> {
    const conversations = await db.conversations
      .where("recipientPubkey")
      .equals(recipientPubkey)
      .toArray();

    return conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);
  }

  /**
   * Gets total conversation count
   */
  async getConversationCount(recipientPubkey: string): Promise<number> {
    return db.conversations
      .where("recipientPubkey")
      .equals(recipientPubkey)
      .count();
  }
}

// Singleton instance
const giftWrapLoader = new GiftWrapLoader();

export default giftWrapLoader;
