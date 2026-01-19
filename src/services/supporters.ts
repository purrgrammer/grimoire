/**
 * Grimoire Supporters Singleton Service
 *
 * Tracks users who have zapped Grimoire by monitoring kind 9735 (zap receipt) events.
 * Subscribes to relays and stores individual zap records in IndexedDB for accurate tracking.
 */

import { Subscription } from "rxjs";
import { firstValueFrom, timeout as rxTimeout, of } from "rxjs";
import { catchError } from "rxjs/operators";
import pool from "./relay-pool";
import relayListCache from "./relay-list-cache";
import { createTimelineLoader, addressLoader } from "./loaders";
import {
  getZapRecipient,
  getZapSender,
  getZapAmount,
  isValidZap,
  getZapRequest,
} from "applesauce-common/helpers/zap";
import { GRIMOIRE_DONATE_PUBKEY } from "@/lib/grimoire-members";
import type { NostrEvent } from "@/types/nostr";
import db, { type GrimoireZap } from "./db";

export interface SupporterInfo {
  pubkey: string;
  totalSats: number;
  zapCount: number;
  lastZapTimestamp: number;
}

/**
 * Monthly donation goal in sats (210k sats = 0.0021 BTC)
 */
export const MONTHLY_GOAL_SATS = 210_000;

/**
 * Premium supporter threshold per month (2.1k sats)
 * Users above this get special badge treatment
 */
export const PREMIUM_SUPPORTER_THRESHOLD = 2_100;

/**
 * Hardcoded relays known to have Grimoire zaps
 * Used as immediate fallback for cold start before relay list loads
 */
const GRIMOIRE_ZAP_RELAYS = ["wss://nos.lol"];

class SupportersService {
  private subscription: Subscription | null = null;

  /**
   * Initialize the service - subscribe to zap receipts
   * Can be called multiple times (re-initializes subscription)
   */
  async init() {
    // Clean up existing subscription if any
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    // Subscribe to new zaps (will fetch relay list)
    await this.subscribeToZapReceipts();
  }

  /**
   * Subscribe to zap receipts for Grimoire donation pubkey
   */
  private async subscribeToZapReceipts() {
    try {
      // Start with hardcoded relays for immediate cold start
      let grimRelays = [...GRIMOIRE_ZAP_RELAYS];

      // Fetch relay list in background (non-blocking)
      // Don't await - let it happen in parallel with subscription
      this.fetchAndMergeRelayList();

      // Subscribe to zap receipts (kind 9735) for Grimoire
      // Using 'p' tag filter for recipient (NIP-57 zap receipts tag the recipient)
      const loader = createTimelineLoader(pool, grimRelays, [
        {
          kinds: [9735],
          "#p": [GRIMOIRE_DONATE_PUBKEY],
          limit: 500, // Many relays reject limits over 500
        },
      ]);

      // Subscribe directly to the loader's observable
      // TimelineLoader returns Observable<NostrEvent> - emits individual events from relays
      const loaderSubscription = loader().subscribe({
        next: (event: NostrEvent) => {
          // Process each event as it arrives from relays
          this.processZapReceipt(event);
        },
        error: (error) => {
          console.error("[Supporters] Timeline loader error:", error);
        },
      });

      // Store subscription for cleanup
      this.subscription = loaderSubscription;
    } catch (error) {
      console.error("[Supporters] Failed to subscribe to zap receipts:", error);
    }
  }

  /**
   * Fetch Grimoire's relay list from kind 10002 (non-blocking)
   * Returns array of relay URLs
   */
  private async fetchAndMergeRelayList(): Promise<string[]> {
    try {
      await firstValueFrom(
        addressLoader({
          kind: 10002,
          pubkey: GRIMOIRE_DONATE_PUBKEY,
          identifier: "",
        }).pipe(
          rxTimeout(10000),
          catchError(() => of(null)),
        ),
      );

      // Give relayListCache a moment to update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get inbox relays from cache
      const inboxRelays = await relayListCache.getInboxRelays(
        GRIMOIRE_DONATE_PUBKEY,
      );

      if (inboxRelays && inboxRelays.length > 0) {
        return inboxRelays;
      }

      return [];
    } catch (err) {
      return [];
    }
  }

  /**
   * Process a zap receipt event and store in DB
   */
  private async processZapReceipt(event: NostrEvent) {
    try {
      // Only process valid zaps
      if (!isValidZap(event)) return;

      // Double-check recipient is Grimoire
      const recipient = getZapRecipient(event);
      if (recipient !== GRIMOIRE_DONATE_PUBKEY) return;

      // Get sender
      const sender = getZapSender(event);
      if (!sender) return;

      // Check if already recorded (deduplication)
      const existing = await db.grimoireZaps.get(event.id);
      if (existing) return;

      // Get amount (millisats -> sats)
      const amountMsats = getZapAmount(event);
      const amountSats = amountMsats ? Math.floor(amountMsats / 1000) : 0;

      // Get comment from zap request
      const zapRequest = getZapRequest(event);
      const comment = zapRequest?.content;

      // Store in DB
      const zapRecord: GrimoireZap = {
        eventId: event.id,
        senderPubkey: sender,
        amountSats,
        timestamp: event.created_at,
        comment: comment || undefined,
      };

      await db.grimoireZaps.add(zapRecord);
    } catch (error) {
      // Silently ignore duplicate key errors (race condition protection)
      if ((error as any).name !== "ConstraintError") {
        console.error("[Supporters] Failed to process zap:", error);
      }
    }
  }

  /**
   * Check if a pubkey is a Grimoire supporter (async)
   */
  async isSupporter(pubkey: string): Promise<boolean> {
    const count = await db.grimoireZaps
      .where("senderPubkey")
      .equals(pubkey)
      .count();
    return count > 0;
  }

  /**
   * Get supporter info for a pubkey (efficient indexed query)
   */
  async getSupporterInfo(pubkey: string): Promise<SupporterInfo | undefined> {
    let totalSats = 0;
    let zapCount = 0;
    let lastZapTimestamp = 0;

    await db.grimoireZaps
      .where("senderPubkey")
      .equals(pubkey)
      .each((zap) => {
        totalSats += zap.amountSats;
        zapCount += 1;
        lastZapTimestamp = Math.max(lastZapTimestamp, zap.timestamp);
      });

    if (zapCount === 0) return undefined;

    return {
      pubkey,
      totalSats,
      zapCount,
      lastZapTimestamp,
    };
  }

  /**
   * Get monthly supporter info for a pubkey
   * Returns sats donated in last 30 days
   */
  async getMonthlySupporterInfo(
    pubkey: string,
  ): Promise<{ totalSats: number; zapCount: number } | undefined> {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

    let totalSats = 0;
    let zapCount = 0;

    // Use compound index [senderPubkey+timestamp] for efficient query
    await db.grimoireZaps
      .where("[senderPubkey+timestamp]")
      .between([pubkey, thirtyDaysAgo], [pubkey, Infinity])
      .each((zap) => {
        totalSats += zap.amountSats;
        zapCount += 1;
      });

    if (zapCount === 0) return undefined;

    return { totalSats, zapCount };
  }

  /**
   * Check if pubkey is a premium supporter (2.1k+ sats this month)
   */
  async isPremiumSupporter(pubkey: string): Promise<boolean> {
    const monthlyInfo = await this.getMonthlySupporterInfo(pubkey);
    return (monthlyInfo?.totalSats || 0) >= PREMIUM_SUPPORTER_THRESHOLD;
  }

  /**
   * Get all supporters sorted by total sats (descending)
   */
  async getAllSupporters(): Promise<SupporterInfo[]> {
    const supporterMap = new Map<string, SupporterInfo>();

    // Use Dexie iteration to avoid loading all into memory
    await db.grimoireZaps.each((zap) => {
      const existing = supporterMap.get(zap.senderPubkey);
      if (existing) {
        existing.totalSats += zap.amountSats;
        existing.zapCount += 1;
        existing.lastZapTimestamp = Math.max(
          existing.lastZapTimestamp,
          zap.timestamp,
        );
      } else {
        supporterMap.set(zap.senderPubkey, {
          pubkey: zap.senderPubkey,
          totalSats: zap.amountSats,
          zapCount: 1,
          lastZapTimestamp: zap.timestamp,
        });
      }
    });

    return Array.from(supporterMap.values()).sort(
      (a, b) => b.totalSats - a.totalSats,
    );
  }

  /**
   * Get total donations (all-time) using Dexie iteration
   */
  async getTotalDonations(): Promise<number> {
    let total = 0;
    await db.grimoireZaps.each((zap) => {
      total += zap.amountSats;
    });
    return total;
  }

  /**
   * Get donations in last 30 days using indexed query
   */
  async getMonthlyDonations(): Promise<number> {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

    let total = 0;
    await db.grimoireZaps
      .where("timestamp")
      .aboveOrEqual(thirtyDaysAgo)
      .each((zap) => {
        total += zap.amountSats;
      });

    return total;
  }

  /**
   * Get donations in current calendar month using indexed query
   */
  async getCurrentMonthDonations(): Promise<number> {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfMonthTimestamp = Math.floor(firstOfMonth.getTime() / 1000);

    let total = 0;
    await db.grimoireZaps
      .where("timestamp")
      .aboveOrEqual(firstOfMonthTimestamp)
      .each((zap) => {
        total += zap.amountSats;
      });

    return total;
  }

  /**
   * Get supporter count using Dexie uniqueKeys
   */
  async getSupporterCount(): Promise<number> {
    const uniquePubkeys = await db.grimoireZaps
      .orderBy("senderPubkey")
      .uniqueKeys();
    return uniquePubkeys.length;
  }

  /**
   * Cleanup when shutting down
   */
  destroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}

// Export singleton instance
const supportersService = new SupportersService();
export default supportersService;

// Legacy export for compatibility
export const initSupporters = () => supportersService.init();
