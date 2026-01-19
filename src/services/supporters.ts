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
 */
async function refreshSupporters() {
  try {
    // Get all zaps from the DB
    const zaps = await db.grimoireZaps.toArray();
    const uniqueSenders = new Set(zaps.map((zap) => zap.senderPubkey));

    // Update total donations cache
    cachedTotalDonations = zaps.reduce((sum, zap) => sum + zap.amountSats, 0);

    // Update monthly donations cache (last 30 days)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const recentZaps = zaps.filter((zap) => zap.timestamp >= thirtyDaysAgo);
    cachedMonthlyDonations = recentZaps.reduce(
      (sum, zap) => sum + zap.amountSats,
      0,
    );

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
 * Get supporter info for a pubkey
 */
export async function getSupporterInfo(
  pubkey: string,
): Promise<SupporterInfo | undefined> {
  const zaps = await db.grimoireZaps
    .where("senderPubkey")
    .equals(pubkey)
    .toArray();

  if (zaps.length === 0) return undefined;

  const totalSats = zaps.reduce((sum, zap) => sum + zap.amountSats, 0);
  const lastZapTimestamp = Math.max(...zaps.map((zap) => zap.timestamp));

  return {
    pubkey,
    totalSats,
    zapCount: zaps.length,
    lastZapTimestamp,
  };
}

/**
 * Get all supporters sorted by total sats (descending)
 */
export async function getAllSupporters(): Promise<SupporterInfo[]> {
  const zaps = await db.grimoireZaps.toArray();

  // Group by sender pubkey
  const supporterMap = new Map<string, SupporterInfo>();

  for (const zap of zaps) {
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
  }

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
 * Queries DB directly for up-to-date value
 */
export async function getTotalDonationsAsync(): Promise<number> {
  const zaps = await db.grimoireZaps.toArray();
  return zaps.reduce((sum, zap) => sum + zap.amountSats, 0);
}

/**
 * Get supporter count
 */
export async function getSupporterCount(): Promise<number> {
  const zaps = await db.grimoireZaps.toArray();
  const uniqueSenders = new Set(zaps.map((zap) => zap.senderPubkey));
  return uniqueSenders.size;
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
 * Queries DB directly for up-to-date value
 */
export async function getMonthlyDonationsAsync(): Promise<number> {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

  const recentZaps = await db.grimoireZaps
    .where("timestamp")
    .aboveOrEqual(thirtyDaysAgo)
    .toArray();

  return recentZaps.reduce((sum, zap) => sum + zap.amountSats, 0);
}

/**
 * Get donations received in the current calendar month
 * Resets on the first of each month
 */
export async function getCurrentMonthDonations(): Promise<number> {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfMonthTimestamp = Math.floor(firstOfMonth.getTime() / 1000);

  const monthZaps = await db.grimoireZaps
    .where("timestamp")
    .aboveOrEqual(firstOfMonthTimestamp)
    .toArray();

  return monthZaps.reduce((sum, zap) => sum + zap.amountSats, 0);
}

/**
 * Monthly donation goal in sats (210 million sats = 2.1 BTC)
 */
export const MONTHLY_GOAL_SATS = 210_000_000;
