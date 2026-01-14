/**
 * Gift Wrap Service - Global gift wrap handling for NIP-59
 *
 * Gift wraps (kind 1059) can contain any kind of event, not just DMs.
 * This service provides global subscription and decryption management
 * that is independent of any specific protocol adapter.
 *
 * Features:
 * - Subscribe to gift wraps from user's inbox relays
 * - Track pending (encrypted), decrypted, and failed gift wraps
 * - Persist decrypted content via applesauce
 * - Enable/disable via settings (persisted to localStorage)
 * - Exposes observables for UI components
 */
import { BehaviorSubject, Observable, Subscription } from "rxjs";
import { map, distinctUntilChanged } from "rxjs/operators";
import type { Filter } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "./event-store";
import pool from "./relay-pool";
import accountManager from "./accounts";
import { relayListCache } from "./relay-list-cache";
import { getEventsForFilters } from "./event-cache";
import { AGGREGATOR_RELAYS } from "./loaders";
import {
  unlockGiftWrap,
  isGiftWrapUnlocked,
  getGiftWrapRumor,
} from "applesauce-common/helpers";

const GIFT_WRAP_KIND = 1059;
const DM_RELAY_LIST_KIND = 10050;
const STORAGE_KEY = "grimoire:gift-wrap-enabled";

/**
 * Gift Wrap Service - Singleton for global gift wrap management
 */
class GiftWrapService {
  /** Whether gift wrap subscription is enabled */
  private enabled$ = new BehaviorSubject<boolean>(this.loadEnabledState());

  /** All gift wraps we've seen */
  private giftWraps$ = new BehaviorSubject<NostrEvent[]>([]);

  /** Gift wrap IDs that are still encrypted (pending decryption) */
  private pendingIds$ = new BehaviorSubject<Set<string>>(new Set());

  /** Gift wrap IDs that failed to decrypt */
  private failedIds$ = new BehaviorSubject<Set<string>>(new Set());

  /** Active subscriptions */
  private subscriptions = new Map<string, Subscription>();

  /** Current user pubkey */
  private currentPubkey: string | null = null;

  /** Whether subscription is currently active */
  private subscriptionActive = false;

  constructor() {
    // React to account changes
    accountManager.active$.subscribe((account) => {
      const newPubkey = account?.pubkey || null;
      if (newPubkey !== this.currentPubkey) {
        this.handleAccountChange(newPubkey);
      }
    });

    // React to enabled state changes
    this.enabled$.pipe(distinctUntilChanged()).subscribe((enabled) => {
      this.saveEnabledState(enabled);
      if (enabled && this.currentPubkey) {
        this.startSubscription(this.currentPubkey);
      } else if (!enabled) {
        this.stopSubscription();
      }
    });
  }

  // ==================== Public API ====================

  /**
   * Check if gift wrap subscription is enabled
   */
  isEnabled(): boolean {
    return this.enabled$.value;
  }

  /**
   * Observable of enabled state
   */
  isEnabled$(): Observable<boolean> {
    return this.enabled$.asObservable();
  }

  /**
   * Enable gift wrap subscription
   */
  enable(): void {
    this.enabled$.next(true);
  }

  /**
   * Disable gift wrap subscription
   */
  disable(): void {
    this.enabled$.next(false);
  }

  /**
   * Toggle enabled state
   */
  toggle(): void {
    this.enabled$.next(!this.enabled$.value);
  }

  /**
   * Get all gift wraps (both encrypted and decrypted)
   */
  getGiftWraps$(): Observable<NostrEvent[]> {
    return this.giftWraps$.asObservable();
  }

  /**
   * Get only decrypted gift wraps
   */
  getDecryptedGiftWraps$(): Observable<NostrEvent[]> {
    return this.giftWraps$.pipe(
      map((wraps) => wraps.filter((w) => isGiftWrapUnlocked(w))),
    );
  }

  /**
   * Get count of pending (encrypted but not failed) gift wraps
   */
  getPendingCount(): number {
    const pending = this.pendingIds$.value;
    const failed = this.failedIds$.value;
    return Array.from(pending).filter((id) => !failed.has(id)).length;
  }

  /**
   * Observable of pending count
   */
  getPendingCount$(): Observable<number> {
    return this.pendingIds$.pipe(
      map((pending) => {
        const failed = this.failedIds$.value;
        return Array.from(pending).filter((id) => !failed.has(id)).length;
      }),
    );
  }

  /**
   * Get count of failed gift wraps
   */
  getFailedCount(): number {
    return this.failedIds$.value.size;
  }

  /**
   * Observable of failed count
   */
  getFailedCount$(): Observable<number> {
    return this.failedIds$.pipe(map((failed) => failed.size));
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

    const failedSet = this.failedIds$.value;
    const pendingIds = Array.from(this.pendingIds$.value).filter(
      (id) => !failedSet.has(id),
    );

    let success = 0;
    let failed = 0;

    for (const giftWrapId of pendingIds) {
      try {
        const giftWrap = this.giftWraps$.value.find((g) => g.id === giftWrapId);
        if (!giftWrap) {
          this.markAsFailed(giftWrapId);
          failed++;
          continue;
        }

        if (isGiftWrapUnlocked(giftWrap)) {
          this.removeFromPending(giftWrapId);
          success++;
          continue;
        }

        // Decrypt using signer - applesauce handles caching
        await unlockGiftWrap(giftWrap, signer);

        this.removeFromPending(giftWrapId);

        // Trigger update so observers know decryption happened
        this.giftWraps$.next([...this.giftWraps$.value]);

        success++;
      } catch (error) {
        console.error(`[GiftWrap] Failed to decrypt ${giftWrapId}:`, error);
        this.markAsFailed(giftWrapId);
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * Get decrypted rumors of a specific kind
   */
  getRumorsByKind$(kind: number): Observable<NostrEvent[]> {
    return this.getDecryptedGiftWraps$().pipe(
      map((wraps) => {
        const rumors: NostrEvent[] = [];
        for (const wrap of wraps) {
          try {
            const rumor = getGiftWrapRumor(wrap);
            if (rumor && rumor.kind === kind) {
              rumors.push({ ...rumor, sig: "" } as NostrEvent);
            }
          } catch {
            // Skip invalid
          }
        }
        return rumors;
      }),
    );
  }

  /**
   * Get inbox relays for a pubkey
   */
  async getInboxRelays(pubkey: string): Promise<string[]> {
    return this.fetchInboxRelays(pubkey);
  }

  // ==================== Private Methods ====================

  private loadEnabledState(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "true";
    } catch {
      return false;
    }
  }

  private saveEnabledState(enabled: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch (error) {
      console.warn("[GiftWrap] Failed to save enabled state:", error);
    }
  }

  private handleAccountChange(newPubkey: string | null): void {
    // Stop existing subscription
    this.stopSubscription();

    // Clear state
    this.giftWraps$.next([]);
    this.pendingIds$.next(new Set());
    this.failedIds$.next(new Set());
    this.currentPubkey = newPubkey;

    // Start new subscription if enabled and logged in
    if (this.enabled$.value && newPubkey) {
      this.startSubscription(newPubkey);
    }
  }

  private async startSubscription(pubkey: string): Promise<void> {
    if (this.subscriptionActive) {
      console.log("[GiftWrap] Subscription already active");
      return;
    }

    console.log("[GiftWrap] Starting subscription for", pubkey.slice(0, 8));
    this.subscriptionActive = true;

    // Load cached gift wraps from Dexie
    await this.loadCachedGiftWraps(pubkey);

    // Subscribe to eventStore.insert$ for locally published gift wraps
    const insertSub = eventStore.insert$.subscribe((event) => {
      if (
        event.kind === GIFT_WRAP_KIND &&
        event.tags.some((t) => t[0] === "p" && t[1] === pubkey)
      ) {
        console.log(
          `[GiftWrap] New gift wrap from local: ${event.id.slice(0, 8)}`,
        );
        this.handleGiftWrap(event);
      }
    });
    this.subscriptions.set("insert", insertSub);

    // Get inbox relays and subscribe
    const inboxRelays = await this.fetchInboxRelays(pubkey);
    if (inboxRelays.length === 0) {
      console.warn("[GiftWrap] No inbox relays found");
      return;
    }

    console.log(`[GiftWrap] Subscribing to ${inboxRelays.length} inbox relays`);

    const filter: Filter = {
      kinds: [GIFT_WRAP_KIND],
      "#p": [pubkey],
    };

    const relaySub = pool
      .subscription(inboxRelays, [filter], { eventStore })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[GiftWrap] EOSE received");
          } else {
            console.log(
              `[GiftWrap] New gift wrap from relay: ${response.id.slice(0, 8)}`,
            );
            this.handleGiftWrap(response);
          }
        },
        error: (err) => {
          console.error("[GiftWrap] Subscription error:", err);
        },
      });

    this.subscriptions.set("relays", relaySub);
  }

  private stopSubscription(): void {
    console.log("[GiftWrap] Stopping subscription");
    this.subscriptionActive = false;

    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
  }

  private async loadCachedGiftWraps(pubkey: string): Promise<void> {
    try {
      const cached = await getEventsForFilters([
        { kinds: [GIFT_WRAP_KIND], "#p": [pubkey] },
      ]);

      if (cached.length > 0) {
        console.log(`[GiftWrap] Loaded ${cached.length} from cache`);
        for (const giftWrap of cached) {
          eventStore.add(giftWrap);
          this.handleGiftWrap(giftWrap);
        }
      }
    } catch (error) {
      console.warn("[GiftWrap] Failed to load cache:", error);
    }
  }

  private handleGiftWrap(giftWrap: NostrEvent): void {
    const current = this.giftWraps$.value;
    if (!current.find((g) => g.id === giftWrap.id)) {
      this.giftWraps$.next([...current, giftWrap]);
    }

    if (!isGiftWrapUnlocked(giftWrap)) {
      if (!this.failedIds$.value.has(giftWrap.id)) {
        const pending = new Set(this.pendingIds$.value);
        pending.add(giftWrap.id);
        this.pendingIds$.next(pending);
      }
    }
  }

  private markAsFailed(id: string): void {
    const failed = new Set(this.failedIds$.value);
    failed.add(id);
    this.failedIds$.next(failed);
  }

  private removeFromPending(id: string): void {
    const pending = new Set(this.pendingIds$.value);
    pending.delete(id);
    this.pendingIds$.next(pending);
  }

  private async fetchInboxRelays(pubkey: string): Promise<string[]> {
    // Check EventStore first
    const existing = eventStore.getReplaceable(DM_RELAY_LIST_KIND, pubkey);
    if (existing) {
      const relays = this.extractRelaysFromEvent(existing);
      if (relays.length > 0) return relays;
    }

    // Search on outbox relays
    const outboxRelays = await relayListCache.getOutboxRelays(pubkey);
    const searchRelays =
      outboxRelays && outboxRelays.length > 0
        ? outboxRelays
        : AGGREGATOR_RELAYS;

    if (searchRelays.length === 0) return [];

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
      return this.extractRelaysFromEvent(events[0]);
    }

    return [];
  }

  private extractRelaysFromEvent(event: NostrEvent): string[] {
    return event.tags.filter((t) => t[0] === "relay" && t[1]).map((t) => t[1]);
  }
}

/**
 * Singleton instance
 */
export const giftWrapService = new GiftWrapService();
