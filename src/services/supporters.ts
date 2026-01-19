/**
 * Grimoire Supporters System
 *
 * Tracks users who have zapped Grimoire by monitoring kind 9735 (zap receipt) events
 * where the recipient is the Grimoire donation pubkey.
 */

import { BehaviorSubject } from "rxjs";
import eventStore from "./event-store";
import {
  getZapRecipient,
  getZapSender,
  getZapAmount,
  isValidZap,
} from "applesauce-common/helpers/zap";
import { GRIMOIRE_DONATE_PUBKEY } from "@/lib/grimoire-members";
import type { NostrEvent } from "@/types/nostr";

export interface SupporterInfo {
  pubkey: string;
  totalSats: number;
  zapCount: number;
  lastZapTimestamp: number;
}

/**
 * Supporters map: pubkey -> SupporterInfo
 */
const supportersMap = new Map<string, SupporterInfo>();

/**
 * Observable set of supporter pubkeys for reactive UI
 */
export const supporters$ = new BehaviorSubject<Set<string>>(new Set());

/**
 * Load supporters from localStorage cache
 */
function loadSupportersFromCache() {
  try {
    const cached = localStorage.getItem("grimoire:supporters");
    if (!cached) return;

    const data = JSON.parse(cached) as Record<string, SupporterInfo>;
    Object.entries(data).forEach(([pubkey, info]) => {
      supportersMap.set(pubkey, info);
    });

    // Emit updated set
    supporters$.next(new Set(supportersMap.keys()));
  } catch (error) {
    console.error("Failed to load supporters from cache:", error);
  }
}

/**
 * Save supporters to localStorage cache
 */
function saveSupportersToCache() {
  try {
    const data = Object.fromEntries(supportersMap.entries());
    localStorage.setItem("grimoire:supporters", JSON.stringify(data));
  } catch (error) {
    console.error("Failed to save supporters to cache:", error);
  }
}

/**
 * Process a zap receipt event and update supporter info
 */
function processZapReceipt(event: NostrEvent) {
  // Only process valid zaps
  if (!isValidZap(event)) return;

  // Check if zap is to Grimoire
  const recipient = getZapRecipient(event);
  if (recipient !== GRIMOIRE_DONATE_PUBKEY) return;

  // Get sender
  const sender = getZapSender(event);
  if (!sender) return;

  // Get amount (in millisats, convert to sats)
  const amountMsats = getZapAmount(event);
  const amountSats = amountMsats ? Math.floor(amountMsats / 1000) : 0;

  // Update or create supporter info
  const existing = supportersMap.get(sender);
  if (existing) {
    existing.totalSats += amountSats;
    existing.zapCount += 1;
    existing.lastZapTimestamp = Math.max(
      existing.lastZapTimestamp,
      event.created_at,
    );
  } else {
    supportersMap.set(sender, {
      pubkey: sender,
      totalSats: amountSats,
      zapCount: 1,
      lastZapTimestamp: event.created_at,
    });
  }

  // Emit updated set
  supporters$.next(new Set(supportersMap.keys()));

  // Persist to cache
  saveSupportersToCache();
}

/**
 * Subscribe to zap receipts and track supporters
 */
function subscribeToZapReceipts() {
  // Subscribe to kind 9735 (zap receipts) events
  const timeline = eventStore.timeline([{ kinds: [9735], limit: 1000 }]);

  // Process existing and new zap receipts
  timeline.subscribe((events) => {
    events.forEach(processZapReceipt);
  });
}

/**
 * Initialize supporter tracking
 */
export function initSupporters() {
  // Load from cache first
  loadSupportersFromCache();

  // Subscribe to new zaps
  subscribeToZapReceipts();
}

/**
 * Check if a pubkey is a Grimoire supporter
 */
export function isSupporter(pubkey: string): boolean {
  return supportersMap.has(pubkey);
}

/**
 * Get supporter info for a pubkey
 */
export function getSupporterInfo(pubkey: string): SupporterInfo | undefined {
  return supportersMap.get(pubkey);
}

/**
 * Get all supporters sorted by total sats (descending)
 */
export function getAllSupporters(): SupporterInfo[] {
  return Array.from(supportersMap.values()).sort(
    (a, b) => b.totalSats - a.totalSats,
  );
}

/**
 * Get total donations received
 */
export function getTotalDonations(): number {
  return Array.from(supportersMap.values()).reduce(
    (sum, info) => sum + info.totalSats,
    0,
  );
}

/**
 * Get supporter count
 */
export function getSupporterCount(): number {
  return supportersMap.size;
}
