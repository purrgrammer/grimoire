import { BehaviorSubject, Subscription, firstValueFrom } from "rxjs";
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { unlockGiftWrap, getGiftWrapSeal } from "applesauce-common/helpers";
import { GiftWrapsModel } from "applesauce-common/models";
import type { ISigner } from "applesauce-signers";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "./event-store";
import pool from "./relay-pool";
import db from "./db";

/**
 * Gift wrap sync state
 */
export interface GiftWrapSyncState {
  syncing: boolean;
  pendingCount: number;
  decryptedCount: number;
  failedCount: number;
  totalCount: number;
  lastSyncAt: number;
}

/**
 * Manager for gift wrap syncing and decryption
 *
 * Simple strategy:
 * 1. Load all gift wraps using paginated timeline loader
 * 2. Subscribe to new gift wraps in real-time
 * 3. Decrypt on demand and cache in Dexie
 * 4. Track counts and state
 */
class GiftWrapManager {
  private state$ = new BehaviorSubject<GiftWrapSyncState>({
    syncing: false,
    pendingCount: 0,
    decryptedCount: 0,
    failedCount: 0,
    totalCount: 0,
    lastSyncAt: 0,
  });

  private subscriptions = new Map<string, Subscription>();

  /**
   * Get observable of gift wrap sync state
   */
  get state() {
    return this.state$.asObservable();
  }

  /**
   * Sync all gift wraps for a pubkey from relays
   * Loads all pages until timeline is exhausted
   */
  async syncAll(pubkey: string, relays: string[]): Promise<void> {
    if (this.state$.value.syncing) {
      console.log("[GiftWrap] Already syncing, skipping...");
      return;
    }

    this.updateState({ syncing: true });
    console.log(
      `[GiftWrap] Starting sync for ${pubkey} on ${relays.length} relays`,
    );

    try {
      // Create timeline loader
      const timeline = createTimelineLoader(
        pool,
        relays,
        { kinds: [1059], "#p": [pubkey], limit: 100 },
        {
          eventStore,
        },
      );

      // Load pages until no more events
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await new Promise<NostrEvent[]>((resolve) => {
          const events: NostrEvent[] = [];
          timeline().subscribe({
            next: (event) => events.push(event),
            complete: () => resolve(events),
            error: (err) => {
              console.error("[GiftWrap] Timeline error:", err);
              resolve(events);
            },
          });
        });

        page++;
        hasMore = result.length > 0;

        if (hasMore) {
          console.log(
            `[GiftWrap] Loaded page ${page}: ${result.length} events`,
          );
        }
      }

      console.log(`[GiftWrap] Sync complete: loaded ${page} pages`);
      await this.updateCounts(pubkey);
      this.updateState({ lastSyncAt: Date.now() });
    } catch (error) {
      console.error("[GiftWrap] Sync error:", error);
    } finally {
      this.updateState({ syncing: false });
    }
  }

  /**
   * Subscribe to new gift wraps in real-time
   */
  subscribeToNew(pubkey: string, relays: string[]): void {
    const key = pubkey;

    // Cleanup existing subscription
    this.subscriptions.get(key)?.unsubscribe();

    console.log(`[GiftWrap] Subscribing to new gift wraps for ${pubkey}`);

    // Subscribe via pool.subscription (auto-adds to eventStore)
    const sub = pool
      .subscription(
        relays,
        [
          {
            kinds: [1059],
            "#p": [pubkey],
            since: Math.floor(Date.now() / 1000),
          },
        ],
        { eventStore },
      )
      .subscribe({
        next: (response) => {
          if (typeof response !== "string") {
            // It's an event
            console.log("[GiftWrap] New gift wrap received:", response.id);
            this.updateCounts(pubkey);
          }
        },
        error: (err) => console.error("[GiftWrap] Subscription error:", err),
      });

    // Store subscription
    this.subscriptions.set(key, sub);
  }

  /**
   * Unsubscribe from gift wrap updates
   */
  unsubscribe(pubkey: string): void {
    this.subscriptions.get(pubkey)?.unsubscribe();
    this.subscriptions.delete(pubkey);
  }

  /**
   * Update counts from EventStore and Dexie
   */
  async updateCounts(pubkey: string): Promise<void> {
    // Get pending count from applesauce model
    const pendingEvents = await firstValueFrom(
      eventStore.model(GiftWrapsModel, pubkey, true),
    );
    // GiftWrapsModel returns an array of events
    const pending = Array.isArray(pendingEvents) ? pendingEvents.length : 0;

    // Get decrypted count from Dexie
    const decrypted = await db.decryptedGiftWraps.count();

    // Get failed count from Dexie
    const failed = await db.giftWrapErrors.count();

    // Total is pending + decrypted
    const total = pending + decrypted;

    this.updateState({
      pendingCount: pending,
      decryptedCount: decrypted,
      failedCount: failed,
      totalCount: total,
    });
  }

  /**
   * Get observable of pending gift wraps
   */
  getPendingGiftWraps(pubkey: string) {
    return eventStore.model(GiftWrapsModel, pubkey, true);
  }

  /**
   * Decrypt a single gift wrap
   * Returns cached result if already decrypted
   */
  async decryptOne(giftWrapId: string, signer: ISigner): Promise<NostrEvent> {
    // Check cache first
    const cached = await db.decryptedGiftWraps.get(giftWrapId);
    if (cached) {
      console.log("[GiftWrap] Using cached decryption:", giftWrapId);
      return cached.rumor;
    }

    // Check if previously failed
    const error = await db.giftWrapErrors.get(giftWrapId);
    if (error && error.attemptCount >= 3) {
      throw new Error(
        `Max decrypt attempts exceeded (${error.attemptCount}): ${error.errorMessage}`,
      );
    }

    // Get gift wrap from EventStore (returns Observable)
    const gift = await firstValueFrom(eventStore.event(giftWrapId));
    if (!gift) {
      throw new Error(`Gift wrap not found: ${giftWrapId}`);
    }

    try {
      console.log("[GiftWrap] Decrypting:", giftWrapId);
      const rumor = await unlockGiftWrap(gift, signer);

      // Cache decrypted rumor
      await db.decryptedGiftWraps.add({
        giftWrapId: gift.id,
        rumorId: rumor.id,
        rumor: rumor as NostrEvent, // Rumor extends NostrEvent but without sig
        sealPubkey: getGiftWrapSeal(gift)?.pubkey || "",
        decryptedAt: Math.floor(Date.now() / 1000),
        receivedAt: gift.created_at,
      });

      console.log("[GiftWrap] Decrypted successfully:", giftWrapId);
      return rumor as NostrEvent;
    } catch (err) {
      const errorMessage = String(err);
      console.error("[GiftWrap] Decryption failed:", giftWrapId, errorMessage);

      // Track error
      await db.giftWrapErrors.put({
        giftWrapId,
        attemptCount: (error?.attemptCount || 0) + 1,
        lastAttempt: Math.floor(Date.now() / 1000),
        errorMessage,
      });

      throw err;
    }
  }

  /**
   * Batch decrypt gift wraps with progress tracking
   */
  async *decryptBatch(
    giftWrapIds: string[],
    signer: ISigner,
  ): AsyncGenerator<{
    id: string;
    status: "success" | "error";
    rumor?: NostrEvent;
    error?: string;
  }> {
    console.log(`[GiftWrap] Batch decrypting ${giftWrapIds.length} gift wraps`);

    for (const id of giftWrapIds) {
      try {
        const rumor = await this.decryptOne(id, signer);
        yield { id, status: "success", rumor };
      } catch (err) {
        yield { id, status: "error", error: String(err) };
      }

      // Small delay to avoid blocking UI
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log("[GiftWrap] Batch decrypt complete");
  }

  /**
   * Clear all failed decryption errors
   */
  async clearErrors(): Promise<void> {
    await db.giftWrapErrors.clear();
    console.log("[GiftWrap] Cleared all decryption errors");
  }

  /**
   * Clear all decrypted gift wraps from cache
   */
  async clearDecrypted(): Promise<void> {
    await db.decryptedGiftWraps.clear();
    await db.giftWrapErrors.clear();
    console.log("[GiftWrap] Cleared all decrypted gift wraps");
  }

  /**
   * Update state (partial update)
   */
  private updateState(partial: Partial<GiftWrapSyncState>): void {
    this.state$.next({ ...this.state$.value, ...partial });
  }
}

// Export singleton instance
const giftWrapManager = new GiftWrapManager();
export default giftWrapManager;
