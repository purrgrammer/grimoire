/**
 * NIP-59 Gift Wrap Loader Service
 *
 * Loads gift wraps (kind 1059) from user's DM relays and processes them.
 * Gift wraps are private messages wrapped in multiple layers of encryption.
 *
 * Architecture:
 * - Fetches from DM relays (NIP-17: kind 10050)
 * - Requires NIP-42 AUTH for relay access
 * - Caches decryption results to avoid re-processing
 * - Supports auto-decrypt or manual decrypt modes
 * - Updates conversation metadata for UI
 *
 * See: https://github.com/nostr-protocol/nips/blob/master/59.md
 * See: https://github.com/nostr-protocol/nips/blob/master/17.md
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
  autoDecrypt: boolean; // Auto-decrypt gift wraps as they arrive
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
    autoDecrypt: false,
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
   * @param autoDecrypt - Whether to auto-decrypt gift wraps as they arrive
   */
  async enable(
    recipientPubkey: string,
    signer: Signer,
    autoDecrypt = false,
  ): Promise<void> {
    // Stop any existing subscription
    this.disable();

    this.currentSigner = signer;

    this.state$.next({
      ...this.state$.value,
      enabled: true,
      autoDecrypt,
      recipientPubkey,
    });

    console.log(
      `[GiftWrapLoader] Enabled for ${recipientPubkey.slice(0, 8)} (autoDecrypt: ${autoDecrypt})`,
    );

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
      autoDecrypt: false,
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

      // If auto-decrypt is enabled, process immediately
      if (state.autoDecrypt) {
        await processGiftWrap(event, state.recipientPubkey, this.currentSigner);
        console.log(
          `[GiftWrapLoader] Auto-decrypted gift wrap ${event.id.slice(0, 8)}`,
        );
      } else {
        // Otherwise, just store the envelope as pending
        await db.giftWraps.put({
          id: event.id,
          recipientPubkey: state.recipientPubkey,
          event,
          status: "pending",
          receivedAt: Date.now(),
        });
        console.log(
          `[GiftWrapLoader] Stored gift wrap ${event.id.slice(0, 8)} for manual decryption`,
        );
      }
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
   * Only runs when autoDecrypt is enabled
   */
  private async processPendingGiftWraps(): Promise<void> {
    const state = this.state$.value;

    // Only auto-process if autoDecrypt is enabled
    if (!state.autoDecrypt || !state.recipientPubkey || !this.currentSigner) {
      return;
    }

    const pending = await getPendingGiftWraps(state.recipientPubkey);

    if (pending.length === 0) {
      return;
    }

    console.log(
      `[GiftWrapLoader] Auto-processing ${pending.length} pending gift wraps`,
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
   * Manually decrypts all pending gift wraps
   * Used when auto-decrypt is disabled
   */
  async decryptPending(): Promise<{
    success: number;
    failed: number;
    total: number;
  }> {
    const state = this.state$.value;

    if (!state.recipientPubkey || !this.currentSigner) {
      console.warn("[GiftWrapLoader] Cannot decrypt: not enabled or no signer");
      return { success: 0, failed: 0, total: 0 };
    }

    const pending = await getPendingGiftWraps(state.recipientPubkey);

    if (pending.length === 0) {
      return { success: 0, failed: 0, total: 0 };
    }

    console.log(
      `[GiftWrapLoader] Manually decrypting ${pending.length} pending gift wraps`,
    );

    let success = 0;
    let failed = 0;

    for (const envelope of pending) {
      try {
        await processGiftWrap(
          envelope.event,
          state.recipientPubkey,
          this.currentSigner,
        );
        success++;
      } catch (error) {
        console.error(
          `[GiftWrapLoader] Failed to decrypt gift wrap ${envelope.id.slice(0, 8)}:`,
          error,
        );
        failed++;
      }
    }

    return { success, failed, total: pending.length };
  }

  /**
   * Gets count of pending (undecrypted) gift wraps
   */
  async getPendingCount(recipientPubkey: string): Promise<number> {
    return db.giftWraps
      .where("[recipientPubkey+status]")
      .equals([recipientPubkey, "pending"])
      .count();
  }

  /**
   * Gets DM relays for a user (kind 10050 per NIP-17)
   */
  private async getInboxRelays(pubkey: string): Promise<string[]> {
    // Try to get from event store - kind 10050 DM relay list
    const event = eventStore.getReplaceable(10050, pubkey, "");
    if (event) {
      // Parse relay URLs from tags
      const relays = event.tags
        .filter((t) => t[0] === "relay" && t[1])
        .map((t) => t[1]);

      if (relays.length > 0) {
        return relays;
      }
    }

    // Fallback: try inbox relays from kind 10002
    let relays = await relayListCache.getInboxRelays(pubkey);

    if (!relays || relays.length === 0) {
      // Try to get from event store
      const fallbackEvent = eventStore.getReplaceable(10002, pubkey, "");
      if (fallbackEvent) {
        // Cache it
        relayListCache.set(fallbackEvent);
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
