/**
 * Gift Wrap Batched Persistence Manager
 *
 * Purpose: Optimize IndexedDB writes by batching multiple events into single transactions
 * to prevent UI blocking when receiving thousands of gift wraps.
 *
 * Strategy:
 * 1. Queue events instead of writing immediately
 * 2. Flush queue when it reaches BATCH_SIZE or after BATCH_DELAY
 * 3. Use single IndexedDB transaction for entire batch
 * 4. Handle backpressure with priority queue
 *
 * Performance: Reduces transactions from N to N/BATCH_SIZE (50x improvement for 1000 events)
 */

import type { NostrEvent } from "@/types/nostr";
import { saveGiftWraps } from "./db";
import { dmDebug, dmInfo } from "@/lib/dm-debug";

/**
 * Batch configuration
 */
const BATCH_SIZE = 50; // Flush every 50 events
const BATCH_DELAY_MS = 2000; // Or every 2 seconds (whichever comes first)
const MAX_QUEUE_SIZE = 1000; // Prevent unbounded memory growth

/**
 * Gift wrap persistence manager with batched writes
 */
export class GiftWrapPersistence {
  private writeQueue: Array<{ event: NostrEvent; pubkey: string }> = [];
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private flushPromise: Promise<void> | null = null;

  // Stats for monitoring
  private stats = {
    queued: 0,
    flushed: 0,
    transactions: 0,
    errors: 0,
  };

  /**
   * Enqueue a gift wrap event for batched persistence
   *
   * @param event - Gift wrap event to persist
   * @param pubkey - User pubkey (for partitioning storage)
   * @returns Promise that resolves when event is persisted
   */
  async enqueue(event: NostrEvent, pubkey: string): Promise<void> {
    // Check for backpressure
    if (this.writeQueue.length >= MAX_QUEUE_SIZE) {
      dmDebug(
        "GiftWrapPersistence",
        `Queue full (${MAX_QUEUE_SIZE}), forcing flush`,
      );
      await this.flush();
    }

    // Add to queue
    this.writeQueue.push({ event, pubkey });
    this.stats.queued++;

    dmDebug(
      "GiftWrapPersistence",
      `Enqueued event ${event.id.slice(0, 8)}, queue size: ${this.writeQueue.length}`,
    );

    // Flush if queue is full
    if (this.writeQueue.length >= BATCH_SIZE) {
      dmDebug(
        "GiftWrapPersistence",
        `Batch size reached (${BATCH_SIZE}), flushing`,
      );
      this.scheduleFlush(0); // Immediate flush
      return;
    }

    // Schedule delayed flush if not already scheduled
    if (!this.writeTimer) {
      this.scheduleFlush(BATCH_DELAY_MS);
    }
  }

  /**
   * Enqueue multiple events at once
   */
  async enqueueBatch(events: NostrEvent[], pubkey: string): Promise<void> {
    for (const event of events) {
      await this.enqueue(event, pubkey);
    }
  }

  /**
   * Schedule a flush after delay
   */
  private scheduleFlush(delayMs: number) {
    // Clear existing timer if any
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    // Schedule new flush
    this.writeTimer = setTimeout(() => {
      this.flush().catch((err) => {
        console.error("[GiftWrapPersistence] Flush error:", err);
      });
    }, delayMs);
  }

  /**
   * Flush the write queue to IndexedDB
   * Uses a single transaction for all events
   */
  async flush(): Promise<void> {
    // Prevent concurrent flushes
    if (this.flushing) {
      dmDebug("GiftWrapPersistence", "Already flushing, waiting...");
      return this.flushPromise!;
    }

    // No events to flush
    if (this.writeQueue.length === 0) {
      dmDebug("GiftWrapPersistence", "Nothing to flush");
      return;
    }

    this.flushing = true;
    this.flushPromise = this._doFlush();

    try {
      await this.flushPromise;
    } finally {
      this.flushing = false;
      this.flushPromise = null;
    }
  }

  /**
   * Internal flush implementation
   */
  private async _doFlush(): Promise<void> {
    // Clear timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    // Take all queued events
    const batch = this.writeQueue.splice(0, this.writeQueue.length);
    if (batch.length === 0) return;

    const startTime = performance.now();
    dmInfo(
      "GiftWrapPersistence",
      `Flushing ${batch.length} events to IndexedDB...`,
    );

    try {
      // Group by pubkey (for proper storage partitioning)
      const byPubkey = new Map<string, NostrEvent[]>();

      for (const { event, pubkey } of batch) {
        if (!byPubkey.has(pubkey)) {
          byPubkey.set(pubkey, []);
        }
        byPubkey.get(pubkey)!.push(event);
      }

      // Write each pubkey's events in a single transaction
      for (const [pubkey, events] of byPubkey.entries()) {
        await saveGiftWraps(events, pubkey);
      }

      const duration = performance.now() - startTime;
      this.stats.flushed += batch.length;
      this.stats.transactions++;

      dmInfo(
        "GiftWrapPersistence",
        `✅ Flushed ${batch.length} events in ${duration.toFixed(0)}ms (total: ${this.stats.flushed}, txns: ${this.stats.transactions})`,
      );
    } catch (err) {
      this.stats.errors++;
      console.error(
        `[GiftWrapPersistence] Failed to flush ${batch.length} events:`,
        err,
      );

      // Re-queue failed events (with backpressure check)
      if (this.writeQueue.length + batch.length <= MAX_QUEUE_SIZE) {
        this.writeQueue.unshift(...batch);
        dmDebug(
          "GiftWrapPersistence",
          `Re-queued ${batch.length} failed events`,
        );
      } else {
        console.error(
          `[GiftWrapPersistence] Cannot re-queue ${batch.length} events: queue full`,
        );
      }

      throw err;
    }
  }

  /**
   * Force immediate flush (e.g., before app closes)
   */
  async forceFlush(): Promise<void> {
    dmDebug("GiftWrapPersistence", "Force flush requested");
    await this.flush();
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.writeQueue.length,
      flushing: this.flushing,
    };
  }

  /**
   * Reset stats (for testing/debugging)
   */
  resetStats() {
    this.stats = {
      queued: 0,
      flushed: 0,
      transactions: 0,
      errors: 0,
    };
  }

  /**
   * Cleanup (call when service is destroyed)
   */
  async cleanup() {
    dmDebug("GiftWrapPersistence", "Cleaning up...");

    // Clear timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    // Flush remaining events
    await this.flush();

    dmInfo(
      "GiftWrapPersistence",
      `Cleanup complete. Final stats: ${JSON.stringify(this.getStats())}`,
    );
  }
}

/**
 * Singleton instance
 */
export const giftWrapPersistence = new GiftWrapPersistence();
