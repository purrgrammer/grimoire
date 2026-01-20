/**
 * NIP-59 Gift Wrap Decryption Service
 * Handles syncing, decrypting, and storing gift-wrapped DMs (NIP-17)
 */

import { BehaviorSubject, Observable, Subscription } from "rxjs";
import type { Filter } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";
import type { GiftWrapDecryption, UnsealedDM } from "./db";
import db from "./db";
import pool from "./relay-pool";
import eventStore from "./event-store";
import accountManager from "./accounts";

/**
 * Statistics about gift wrap processing
 */
export interface GiftWrapStats {
  totalGiftWraps: number;
  successfulDecryptions: number;
  failedDecryptions: number;
  pendingDecryptions: number;
  oldestGiftWrap?: number; // Unix timestamp of oldest gift wrap
  newestGiftWrap?: number; // Unix timestamp of newest gift wrap
}

/**
 * Gift wrap sync configuration
 */
const GIFT_WRAP_CONFIG = {
  INITIAL_LIMIT: 500, // Max gift wraps to fetch on initial sync
  PAGINATION_SIZE: 100, // Batch size for loading older gift wraps
  MAX_STORAGE_DAYS: 90, // Keep gift wraps for 90 days
  AUTH_TIMEOUT_MS: 10000, // Wait 10s for auth before proceeding
};

/**
 * Rumor structure (unsigned event from NIP-59)
 */
interface Rumor {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey: string;
}

/**
 * Gift Wrap Manager
 * Singleton service for managing NIP-17 gift wrap decryption
 */
class GiftWrapManager {
  private subscriptions = new Map<string, Subscription>();
  private stats$ = new BehaviorSubject<GiftWrapStats>({
    totalGiftWraps: 0,
    successfulDecryptions: 0,
    failedDecryptions: 0,
    pendingDecryptions: 0,
  });
  private lastSyncTimestamp: number = 0; // Last sync time (for incremental updates)
  private isAuthenticating = false;
  private authenticated = new Set<string>(); // Track which relays are authenticated
  private isSyncing = false; // Prevent concurrent sync attempts

  /**
   * Start syncing gift wraps for the active account
   * 1. Gets DM relays
   * 2. Authenticates with dummy REQ (triggers NIP-42 AUTH)
   * 3. Subscribes to gift wraps with pagination
   */
  async startSync(): Promise<void> {
    // Prevent concurrent sync attempts
    if (this.isSyncing) {
      console.log("[GiftWrap] Sync already in progress, skipping");
      return;
    }

    const account = accountManager.active$.value;
    if (!account) {
      console.log("[GiftWrap] No active account");
      return;
    }

    const { pubkey } = account;
    console.log(`[GiftWrap] Starting sync for ${pubkey.slice(0, 8)}...`);

    this.isSyncing = true;

    try {
      // Stop any existing sync
      this.stopSync();

      // Get user's DM relays (kind 10050) or fall back to general relays
      const dmRelays = await this.getDMRelays(pubkey);
      if (dmRelays.length === 0) {
        console.warn("[GiftWrap] No DM relays found, cannot sync gift wraps");
        // TODO: Get general relays from user's relay list
        return;
      }

      console.log(
        `[GiftWrap] Syncing from ${dmRelays.length} relays:`,
        dmRelays,
      );

      // Step 1: Authenticate with relays using dummy REQ
      // This triggers NIP-42 AUTH which is required for relays to serve kind 1059
      await this.authenticateWithRelays(dmRelays, pubkey);

      // Step 2: Determine sync window (initial vs incremental)
      const now = Math.floor(Date.now() / 1000);
      const isInitialSync = this.lastSyncTimestamp === 0;

      let since: number | undefined;
      if (isInitialSync) {
        // Initial sync: Fetch last N days of gift wraps
        since = now - GIFT_WRAP_CONFIG.MAX_STORAGE_DAYS * 24 * 60 * 60;
        console.log(
          `[GiftWrap] Initial sync from ${new Date(since * 1000).toISOString()}`,
        );
      } else {
        // Incremental sync: Fetch only new gift wraps since last sync
        since = this.lastSyncTimestamp;
        console.log(
          `[GiftWrap] Incremental sync from ${new Date(since * 1000).toISOString()}`,
        );
      }

      // Step 3: Subscribe to gift wraps with pagination
      const filter: Filter = {
        kinds: [1059],
        "#p": [pubkey],
        since,
        limit: isInitialSync ? GIFT_WRAP_CONFIG.INITIAL_LIMIT : undefined,
      };

      const subscription = pool
        .subscription(dmRelays, [filter], {
          eventStore, // Automatically add to event store
        })
        .subscribe({
          next: (response) => {
            if (typeof response === "string") {
              console.log("[GiftWrap] EOSE received");
              // Update last sync timestamp after EOSE
              this.lastSyncTimestamp = now;
            } else {
              console.log(
                `[GiftWrap] Received gift wrap: ${response.id.slice(0, 8)}...`,
              );
              // Process gift wrap asynchronously
              this.processGiftWrap(response, pubkey).catch((error) => {
                console.error(
                  `[GiftWrap] Error processing ${response.id.slice(0, 8)}:`,
                  error,
                );
              });
            }
          },
          error: (error) => {
            console.error("[GiftWrap] Subscription error:", error);
          },
        });

      this.subscriptions.set(pubkey, subscription);

      // Process any existing gift wraps in the event store (from previous sessions)
      await this.processExistingGiftWraps(pubkey);

      // Update stats
      await this.updateStats();

      // Clean up old gift wraps
      await this.cleanupOldGiftWraps();
    } catch (error) {
      console.error("[GiftWrap] Fatal error during sync:", error);
      // Clean up on error
      this.stopSync();
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Stop syncing gift wraps
   */
  stopSync(): void {
    console.log("[GiftWrap] Stopping sync");
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.clear();
  }

  /**
   * Authenticate with relays using dummy REQ
   * This triggers NIP-42 AUTH which is required for relays to serve kind 1059
   */
  private async authenticateWithRelays(
    relays: string[],
    pubkey: string,
  ): Promise<void> {
    if (this.isAuthenticating) {
      console.log("[GiftWrap] Already authenticating, skipping");
      return;
    }

    this.isAuthenticating = true;
    console.log("[GiftWrap] Authenticating with relays...");

    try {
      // Send a dummy REQ to trigger AUTH
      // We'll request kind 1059 with a very restrictive filter (no results expected)
      const dummyFilter: Filter = {
        kinds: [1059],
        "#p": [pubkey],
        limit: 1,
        since: Math.floor(Date.now() / 1000), // Only future events (none exist)
      };

      // Create a promise that resolves after timeout or first event
      await new Promise<void>((resolve) => {
        let subscription: Subscription | null = null;

        const timeout = setTimeout(() => {
          if (subscription) {
            subscription.unsubscribe();
          }
          resolve();
        }, GIFT_WRAP_CONFIG.AUTH_TIMEOUT_MS);

        subscription = pool.subscription(relays, [dummyFilter], {}).subscribe({
          next: (response) => {
            // Got EOSE or event, auth likely completed
            if (typeof response === "string") {
              clearTimeout(timeout);
              if (subscription) {
                subscription.unsubscribe();
              }
              resolve();
            }
          },
          error: () => {
            clearTimeout(timeout);
            if (subscription) {
              subscription.unsubscribe();
            }
            resolve();
          },
        });
      });

      console.log("[GiftWrap] Authentication complete");
      relays.forEach((relay) => this.authenticated.add(relay));
    } catch (error) {
      console.error("[GiftWrap] Authentication error:", error);
    } finally {
      this.isAuthenticating = false;
    }
  }

  /**
   * Load older gift wraps for pagination
   * Fetches gift wraps before the oldest currently loaded
   */
  async loadOlderGiftWraps(): Promise<number> {
    const account = accountManager.active$.value;
    if (!account) {
      console.log("[GiftWrap] No active account");
      return 0;
    }

    const { pubkey } = account;

    // Get oldest gift wrap timestamp, or use lastSyncTimestamp if no gift wraps yet
    const decryptions = await db.giftWrapDecryptions
      .where("recipientPubkey")
      .equals(pubkey)
      .sortBy("lastAttempt");

    let oldestTimestamp: number;
    if (decryptions.length === 0) {
      // No gift wraps yet - use lastSyncTimestamp or current time
      if (this.lastSyncTimestamp > 0) {
        oldestTimestamp = this.lastSyncTimestamp;
        console.log("[GiftWrap] No gift wraps yet, using last sync timestamp");
      } else {
        // First time - start from 90 days ago
        const now = Math.floor(Date.now() / 1000);
        oldestTimestamp =
          now - GIFT_WRAP_CONFIG.MAX_STORAGE_DAYS * 24 * 60 * 60;
        console.log("[GiftWrap] No gift wraps yet, starting from 90 days ago");
      }
    } else {
      oldestTimestamp = decryptions[0].lastAttempt;
    }

    const cutoff = oldestTimestamp - 30 * 24 * 60 * 60; // 30 days before oldest

    console.log(
      `[GiftWrap] Loading older gift wraps before ${new Date(oldestTimestamp * 1000).toISOString()}`,
    );

    // Get DM relays
    const dmRelays = await this.getDMRelays(pubkey);
    if (dmRelays.length === 0) {
      console.warn("[GiftWrap] No DM relays found");
      return 0;
    }

    // Fetch older gift wraps
    const filter: Filter = {
      kinds: [1059],
      "#p": [pubkey],
      until: oldestTimestamp,
      since: cutoff,
      limit: GIFT_WRAP_CONFIG.PAGINATION_SIZE,
    };

    let count = 0;

    await new Promise<void>((resolve) => {
      const subscription = pool
        .subscription(dmRelays, [filter], {
          eventStore,
        })
        .subscribe({
          next: (response) => {
            if (typeof response === "string") {
              console.log(`[GiftWrap] Loaded ${count} older gift wraps`);
              subscription.unsubscribe();
              resolve();
            } else {
              count++;
              this.processGiftWrap(response, pubkey).catch((error) => {
                console.error(
                  `[GiftWrap] Error processing ${response.id.slice(0, 8)}:`,
                  error,
                );
              });
            }
          },
          error: () => {
            subscription.unsubscribe();
            resolve();
          },
        });
    });

    // Update stats
    await this.updateStats();

    return count;
  }

  /**
   * Clean up old gift wraps to prevent storage bloat
   * Removes decryption records older than MAX_STORAGE_DAYS
   */
  private async cleanupOldGiftWraps(): Promise<void> {
    const cutoff =
      Math.floor(Date.now() / 1000) -
      GIFT_WRAP_CONFIG.MAX_STORAGE_DAYS * 24 * 60 * 60;

    console.log(
      `[GiftWrap] Cleaning up gift wraps older than ${new Date(cutoff * 1000).toISOString()}`,
    );

    // Delete old decryption records
    const oldDecryptions = await db.giftWrapDecryptions
      .where("lastAttempt")
      .below(cutoff)
      .toArray();

    if (oldDecryptions.length > 0) {
      console.log(
        `[GiftWrap] Removing ${oldDecryptions.length} old decryption records`,
      );
      await db.giftWrapDecryptions.bulkDelete(
        oldDecryptions.map((d) => d.giftWrapId),
      );
    }

    // Delete old unsealed DMs
    const oldDMs = await db.unsealedDMs
      .where("receivedAt")
      .below(cutoff)
      .toArray();

    if (oldDMs.length > 0) {
      console.log(`[GiftWrap] Removing ${oldDMs.length} old unsealed DMs`);
      await db.unsealedDMs.bulkDelete(oldDMs.map((d) => d.id));
    }
  }

  /**
   * Get DM relays from user's kind 10050 event, with fallback to general relays
   */
  private async getDMRelays(pubkey: string): Promise<string[]> {
    // Try to get kind 10050 (DM relay list) from event store
    const dmRelayEvent = eventStore.getReplaceable(10050, pubkey, "");

    if (dmRelayEvent) {
      // Extract relay URLs from "relay" tags
      const relays = dmRelayEvent.tags
        .filter((t: string[]) => t[0] === "relay" && t[1])
        .map((t: string[]) => t[1]);

      if (relays.length > 0) {
        console.log(
          `[GiftWrap] Using ${relays.length} DM relays from kind 10050`,
        );
        return relays;
      }
    }

    console.log(
      "[GiftWrap] No kind 10050 found, falling back to general relays",
    );

    // Fall back to general relay list (kind 10002)
    const relayListEvent = eventStore.getReplaceable(10002, pubkey, "");
    if (relayListEvent) {
      const relays = relayListEvent.tags
        .filter((t: string[]) => t[0] === "r" && t[1])
        .map((t: string[]) => t[1]);

      if (relays.length > 0) {
        console.log(`[GiftWrap] Using ${relays.length} relays from kind 10002`);
        return relays;
      }
    }

    console.log("[GiftWrap] No kind 10002 found, falling back to contact list");

    // Final fallback to contact list relays (kind 3)
    const contactsEvent = eventStore.getReplaceable(3, pubkey, "");
    if (contactsEvent) {
      try {
        const content = JSON.parse(contactsEvent.content);
        if (typeof content === "object" && content !== null) {
          const relays = Object.keys(content);
          if (relays.length > 0) {
            console.log(`[GiftWrap] Using ${relays.length} relays from kind 3`);
            return relays;
          }
        }
      } catch (error) {
        console.warn("[GiftWrap] Failed to parse kind 3 content:", error);
      }
    }

    console.warn("[GiftWrap] No relays found for user");
    return [];
  }

  /**
   * Process existing gift wraps from event store
   */
  private async processExistingGiftWraps(pubkey: string): Promise<void> {
    console.log("[GiftWrap] Processing existing gift wraps...");

    // Get all kind 1059 events addressed to us
    const giftWraps = eventStore.getByFilters({
      kinds: [1059],
      "#p": [pubkey],
    });

    console.log(`[GiftWrap] Found ${giftWraps.length} existing gift wraps`);

    // Process each gift wrap
    for (const giftWrap of giftWraps) {
      try {
        await this.processGiftWrap(giftWrap, pubkey);
      } catch (error) {
        console.error(
          `[GiftWrap] Error processing ${giftWrap.id.slice(0, 8)}:`,
          error,
        );
      }
    }
  }

  /**
   * Process a single gift wrap event
   */
  private async processGiftWrap(
    giftWrap: NostrEvent,
    recipientPubkey: string,
  ): Promise<void> {
    const giftWrapId = giftWrap.id;

    // Check if we've already processed this gift wrap
    const existing = await db.giftWrapDecryptions.get(giftWrapId);
    if (existing) {
      if (existing.decryptionState === "success") {
        // Already successfully decrypted
        return;
      }
      if (existing.decryptionState === "failed" && existing.attempts >= 3) {
        // Failed too many times, don't retry
        return;
      }
    }

    // Create or update decryption record
    const decryption: GiftWrapDecryption = {
      giftWrapId,
      recipientPubkey,
      decryptionState: "pending",
      lastAttempt: Math.floor(Date.now() / 1000),
      attempts: (existing?.attempts || 0) + 1,
    };

    try {
      await db.giftWrapDecryptions.put(decryption);

      // Attempt to decrypt the gift wrap
      const unsealed = await this.decryptGiftWrap(giftWrap, recipientPubkey);

      if (unsealed) {
        // Update decryption state to success
        decryption.decryptionState = "success";
        decryption.sealEventId = unsealed.sealId;
        decryption.rumorEventId = unsealed.id;
        await db.giftWrapDecryptions.put(decryption);

        // Store the unsealed DM
        await db.unsealedDMs.put(unsealed);

        console.log(
          `[GiftWrap] Successfully decrypted ${giftWrapId.slice(0, 8)}... from ${unsealed.senderPubkey.slice(0, 8)}...`,
        );
      }
    } catch (error) {
      // Update decryption state to failed
      decryption.decryptionState = "failed";
      decryption.errorMessage =
        error instanceof Error ? error.message : String(error);
      await db.giftWrapDecryptions.put(decryption);

      console.error(
        `[GiftWrap] Failed to decrypt ${giftWrapId.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Decrypt a gift wrap event (NIP-59 + NIP-17)
   * Returns the unsealed DM or null if decryption fails
   */
  private async decryptGiftWrap(
    giftWrap: NostrEvent,
    recipientPubkey: string,
  ): Promise<UnsealedDM | null> {
    // Get the active account's signer for decryption
    const account = accountManager.active$.value;
    if (!account?.signer) {
      throw new Error("No active signer available");
    }

    const signer = account.signer;

    // Verify this gift wrap is addressed to us
    const pTag = giftWrap.tags.find(
      (t) => t[0] === "p" && t[1] === recipientPubkey,
    );
    if (!pTag) {
      throw new Error("Gift wrap not addressed to this pubkey");
    }

    // Helper to call NIP-44 decrypt (supports both signer patterns)
    const nip44Decrypt = async (
      pubkey: string,
      ciphertext: string,
    ): Promise<string> => {
      // Try direct method (PasswordSigner, NostrConnectSigner, etc.)
      if (typeof signer.nip44Decrypt === "function") {
        return await signer.nip44Decrypt(pubkey, ciphertext);
      }

      // Try nip44 getter (ExtensionSigner)
      if (signer.nip44 && typeof signer.nip44.decrypt === "function") {
        return await signer.nip44.decrypt(pubkey, ciphertext);
      }

      throw new Error("Signer does not support NIP-44 decryption");
    };

    // Step 1: Decrypt the gift wrap to get the seal (kind 13)
    // The gift wrap is encrypted with the conversation key between
    // the random ephemeral key (giftWrap.pubkey) and our key (recipientPubkey)
    let sealJSON: string;
    try {
      sealJSON = await nip44Decrypt(giftWrap.pubkey, giftWrap.content);
    } catch (error) {
      throw new Error(`Failed to decrypt gift wrap: ${error}`);
    }

    // Parse the seal event
    let seal: NostrEvent;
    try {
      seal = JSON.parse(sealJSON);
    } catch (error) {
      throw new Error(`Failed to parse seal JSON: ${error}`);
    }

    // Verify it's a kind 13 seal
    if (seal.kind !== 13) {
      throw new Error(`Expected kind 13 seal, got kind ${seal.kind}`);
    }

    // Step 2: Decrypt the seal to get the rumor (kind 14 or 15)
    // The seal is encrypted with the conversation key between
    // the sender (seal.pubkey) and us (recipientPubkey)
    let rumorJSON: string;
    try {
      rumorJSON = await nip44Decrypt(seal.pubkey, seal.content);
    } catch (error) {
      throw new Error(`Failed to decrypt seal: ${error}`);
    }

    // Parse the rumor event (unsigned)
    let rumor: Rumor;
    try {
      rumor = JSON.parse(rumorJSON);
    } catch (error) {
      throw new Error(`Failed to parse rumor JSON: ${error}`);
    }

    // Verify it's a kind 14 (message) or kind 15 (file)
    if (rumor.kind !== 14 && rumor.kind !== 15) {
      throw new Error(`Expected kind 14 or 15 rumor, got kind ${rumor.kind}`);
    }

    // Verify the rumor's pubkey matches the seal's pubkey (prevent spoofing)
    if (rumor.pubkey !== seal.pubkey) {
      throw new Error(
        "Rumor pubkey does not match seal pubkey (spoofing attempt)",
      );
    }

    // Generate a unique ID for this rumor (since it's unsigned)
    // Use a combination of gift wrap ID + seal ID
    const rumorId = `${giftWrap.id}:${seal.id}`;

    // Create conversation key (sorted pubkeys for consistency)
    const conversationKey = [seal.pubkey, recipientPubkey].sort().join(":");

    // Create the unsealed DM record
    const unsealed: UnsealedDM = {
      id: rumorId,
      giftWrapId: giftWrap.id,
      sealId: seal.id,
      senderPubkey: seal.pubkey,
      recipientPubkey,
      conversationKey,
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      createdAt: rumor.created_at,
      receivedAt: Math.floor(Date.now() / 1000),
    };

    return unsealed;
  }

  /**
   * Update statistics (optimized to avoid loading all records into memory)
   */
  private async updateStats(): Promise<void> {
    // Use Dexie's count() to avoid loading all records
    const totalGiftWraps = await db.giftWrapDecryptions.count();
    const successfulDecryptions = await db.giftWrapDecryptions
      .where("decryptionState")
      .equals("success")
      .count();
    const failedDecryptions = await db.giftWrapDecryptions
      .where("decryptionState")
      .equals("failed")
      .count();
    const pendingDecryptions = await db.giftWrapDecryptions
      .where("decryptionState")
      .equals("pending")
      .count();

    // Find oldest and newest gift wrap timestamps efficiently
    let oldestTimestamp: number | undefined;
    let newestTimestamp: number | undefined;

    if (totalGiftWraps > 0) {
      const oldest = await db.giftWrapDecryptions
        .orderBy("lastAttempt")
        .first();
      const newest = await db.giftWrapDecryptions
        .orderBy("lastAttempt")
        .reverse()
        .first();

      oldestTimestamp = oldest?.lastAttempt;
      newestTimestamp = newest?.lastAttempt;
    }

    const stats: GiftWrapStats = {
      totalGiftWraps,
      successfulDecryptions,
      failedDecryptions,
      pendingDecryptions,
      oldestGiftWrap: oldestTimestamp,
      newestGiftWrap: newestTimestamp,
    };

    this.stats$.next(stats);
  }

  /**
   * Get statistics observable
   */
  getStats(): Observable<GiftWrapStats> {
    return this.stats$.asObservable();
  }

  /**
   * Get all unsealed DMs for a conversation
   */
  async getConversationMessages(
    conversationKey: string,
  ): Promise<UnsealedDM[]> {
    return db.unsealedDMs
      .where("conversationKey")
      .equals(conversationKey)
      .and((dm) => !dm.deleted)
      .sortBy("createdAt");
  }

  /**
   * Get all conversations for a user
   * Returns a map of conversation keys to latest message
   */
  async getConversations(userPubkey: string): Promise<Map<string, UnsealedDM>> {
    const dms = await db.unsealedDMs
      .where("recipientPubkey")
      .equals(userPubkey)
      .or("senderPubkey")
      .equals(userPubkey)
      .and((dm) => !dm.deleted)
      .toArray();

    // Group by conversation key and get latest message
    const conversations = new Map<string, UnsealedDM>();

    for (const dm of dms) {
      const existing = conversations.get(dm.conversationKey);
      if (!existing || dm.createdAt > existing.createdAt) {
        conversations.set(dm.conversationKey, dm);
      }
    }

    return conversations;
  }

  /**
   * Delete a conversation (soft delete)
   */
  async deleteConversation(conversationKey: string): Promise<void> {
    const dms = await db.unsealedDMs
      .where("conversationKey")
      .equals(conversationKey)
      .toArray();

    for (const dm of dms) {
      await db.unsealedDMs.update(dm.id, { deleted: true });
    }
  }
}

// Export singleton instance
const giftWrapManager = new GiftWrapManager();
export default giftWrapManager;
