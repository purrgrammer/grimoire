/**
 * Grimoire Supporters System
 *
 * Tracks users who have zapped Grimoire by monitoring kind 9735 (zap receipt) events
 * where the recipient is the Grimoire donation pubkey. Stores individual zap records
 * in IndexedDB for accurate monthly tracking and historical data.
 */

import { BehaviorSubject } from "rxjs";
import eventStore from "./event-store";
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
 * Observable set of supporter pubkeys for reactive UI
 * Updated whenever a new zap is recorded
 */
export const supporters$ = new BehaviorSubject<Set<string>>(new Set());

/**
 * Cached total donations (all-time)
 * Updated when new zaps are processed
 */
let cachedTotalDonations = 0;

/**
 * Cached monthly donations
 * Updated when new zaps are processed
 */
let cachedMonthlyDonations = 0;

/**
 * Load supporters from DB and update reactive observable and cached values
 * Uses efficient Dexie queries to minimize memory usage
 */
async function refreshSupporters() {
  try {
    // Get unique sender pubkeys efficiently
    const uniquePubkeys = await db.grimoireZaps
      .orderBy("senderPubkey")
      .uniqueKeys();
    const uniqueSenders = new Set(uniquePubkeys as string[]);

    // Calculate total donations by iterating once
    let totalDonations = 0;
    await db.grimoireZaps.each((zap) => {
      totalDonations += zap.amountSats;
    });
    cachedTotalDonations = totalDonations;

    // Calculate monthly donations efficiently (indexed query)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    let monthlyDonations = 0;
    await db.grimoireZaps
      .where("timestamp")
      .aboveOrEqual(thirtyDaysAgo)
      .each((zap) => {
        monthlyDonations += zap.amountSats;
      });
    cachedMonthlyDonations = monthlyDonations;

    // Emit updated set
    supporters$.next(uniqueSenders);
  } catch (error) {
    console.error("Failed to refresh supporters from DB:", error);
  }
}

/**
 * Process a zap receipt event and store in DB
 */
async function processZapReceipt(event: NostrEvent) {
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

  // Get comment from zap request
  const zapRequest = getZapRequest(event);
  const comment = zapRequest?.content;

  // Check if we've already recorded this zap
  const existing = await db.grimoireZaps.get(event.id);
  if (existing) return; // Already recorded

  // Store zap in DB
  const zapRecord: GrimoireZap = {
    eventId: event.id,
    senderPubkey: sender,
    amountSats,
    timestamp: event.created_at,
    comment: comment || undefined,
  };

  try {
    await db.grimoireZaps.add(zapRecord);

    // Refresh supporters observable
    await refreshSupporters();
  } catch (error) {
    console.error("Failed to store zap in DB:", error);
  }
}

/**
 * Subscribe to zap receipts and track supporters
 */
function subscribeToZapReceipts() {
  // Subscribe to kind 9735 (zap receipts) events
  const timeline = eventStore.timeline([{ kinds: [9735], limit: 1000 }]);

  // Process existing and new zap receipts
  timeline.subscribe(async (events) => {
    // Process all events in parallel (DB handles deduplication)
    await Promise.all(events.map((event) => processZapReceipt(event)));
  });
}

/**
 * Initialize supporter tracking
 */
export function initSupporters() {
  // Load supporters from DB
  refreshSupporters();

  // Subscribe to new zaps
  subscribeToZapReceipts();
}

/**
 * Check if a pubkey is a Grimoire supporter
 */
export async function isSupporter(pubkey: string): Promise<boolean> {
  const count = await db.grimoireZaps
    .where("senderPubkey")
    .equals(pubkey)
    .count();
  return count > 0;
}

/**
 * Get supporter info for a pubkey (efficient indexed query)
 */
export async function getSupporterInfo(
  pubkey: string,
): Promise<SupporterInfo | undefined> {
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
 * Get all supporters sorted by total sats (descending)
 * Groups and aggregates efficiently using Map
 */
export async function getAllSupporters(): Promise<SupporterInfo[]> {
  // Group by sender pubkey efficiently
  const supporterMap = new Map<string, SupporterInfo>();

  // Use Dexie iteration to avoid loading all into memory at once
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

  // Sort by total sats descending
  return Array.from(supporterMap.values()).sort(
    (a, b) => b.totalSats - a.totalSats,
  );
}

/**
 * Get total donations received (all-time)
 * Returns cached value for synchronous access
 */
export function getTotalDonations(): number {
  return cachedTotalDonations;
}

/**
 * Get total donations received (all-time) - async version
 * Queries DB directly for up-to-date value using efficient iteration
 */
export async function getTotalDonationsAsync(): Promise<number> {
  let total = 0;
  await db.grimoireZaps.each((zap) => {
    total += zap.amountSats;
  });
  return total;
}

/**
 * Get supporter count (efficient - uses Dexie uniqueKeys)
 */
export async function getSupporterCount(): Promise<number> {
  const uniquePubkeys = await db.grimoireZaps
    .orderBy("senderPubkey")
    .uniqueKeys();
  return uniquePubkeys.length;
}

/**
 * Get donations received in the last 30 days
 * Returns cached value for synchronous access
 */
export function getMonthlyDonations(): number {
  return cachedMonthlyDonations;
}

/**
 * Get donations received in the last 30 days - async version
 * Queries DB directly for up-to-date value using indexed query
 */
export async function getMonthlyDonationsAsync(): Promise<number> {
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
 * Get donations received in the current calendar month
 * Resets on the first of each month (efficient indexed query)
 */
export async function getCurrentMonthDonations(): Promise<number> {
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
 * Monthly donation goal in sats (210k sats = 0.0021 BTC)
 */
export const MONTHLY_GOAL_SATS = 210_000;
