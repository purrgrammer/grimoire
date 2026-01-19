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
}

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

  /**
   * Start syncing gift wraps for the active account
   * Subscribes to kind 1059 events from user's DM relays
   */
  async startSync(): Promise<void> {
    const account = accountManager.active$.value;
    if (!account) {
      console.log("[GiftWrap] No active account");
      return;
    }

    const { pubkey } = account;
    console.log(`[GiftWrap] Starting sync for ${pubkey.slice(0, 8)}...`);

    // Stop any existing sync
    this.stopSync();

    // Get user's DM relays (kind 10050) or fall back to general relays
    const dmRelays = await this.getDMRelays(pubkey);
    if (dmRelays.length === 0) {
      console.warn("[GiftWrap] No DM relays found, using general relays");
      // TODO: Get general relays from user's relay list
      return;
    }

    console.log(`[GiftWrap] Syncing from ${dmRelays.length} relays:`, dmRelays);

    // Subscribe to gift wraps (kind 1059) addressed to us
    const filter: Filter = {
      kinds: [1059],
      "#p": [pubkey],
      limit: 100,
    };

    const subscription = pool
      .subscription(dmRelays, [filter], {
        eventStore, // Automatically add to event store
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[GiftWrap] EOSE received");
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

    // Process any existing gift wraps in the event store
    await this.processExistingGiftWraps(pubkey);

    // Update stats
    await this.updateStats();
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
   * Get DM relays from user's kind 10050 event
   */
  private async getDMRelays(pubkey: string): Promise<string[]> {
    // Try to get kind 10050 from event store
    const dmRelayEvent = eventStore.get(
      eventStore
        .getAll()
        .filter((e) => e.kind === 10050 && e.pubkey === pubkey)
        .sort((a, b) => b.created_at - a.created_at)[0]?.id || "",
    );

    if (dmRelayEvent) {
      // Extract relay URLs from "relay" tags
      const relays = dmRelayEvent.tags
        .filter((t) => t[0] === "relay" && t[1])
        .map((t) => t[1]);

      if (relays.length > 0) {
        return relays;
      }
    }

    // TODO: Fall back to general relay list (kind 10002 or kind 3)
    return [];
  }

  /**
   * Process existing gift wraps from event store
   */
  private async processExistingGiftWraps(pubkey: string): Promise<void> {
    console.log("[GiftWrap] Processing existing gift wraps...");

    // Get all kind 1059 events addressed to us
    const giftWraps = eventStore
      .getAll()
      .filter(
        (e) =>
          e.kind === 1059 &&
          e.tags.some((t) => t[0] === "p" && t[1] === pubkey),
      );

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

    // Step 1: Decrypt the gift wrap to get the seal (kind 13)
    // The gift wrap is encrypted with the conversation key between
    // the random ephemeral key (giftWrap.pubkey) and our key (recipientPubkey)
    let sealJSON: string;
    try {
      // Check if signer has nip44Decrypt capability
      if (!signer.nip44Decrypt) {
        throw new Error("Signer does not support NIP-44 decryption");
      }

      sealJSON = await signer.nip44Decrypt(giftWrap.pubkey, giftWrap.content);
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
      if (!signer.nip44Decrypt) {
        throw new Error("Signer does not support NIP-44 decryption");
      }

      rumorJSON = await signer.nip44Decrypt(seal.pubkey, seal.content);
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
   * Update statistics
   */
  private async updateStats(): Promise<void> {
    const decryptions = await db.giftWrapDecryptions.toArray();

    const stats: GiftWrapStats = {
      totalGiftWraps: decryptions.length,
      successfulDecryptions: decryptions.filter(
        (d) => d.decryptionState === "success",
      ).length,
      failedDecryptions: decryptions.filter(
        (d) => d.decryptionState === "failed",
      ).length,
      pendingDecryptions: decryptions.filter(
        (d) => d.decryptionState === "pending",
      ).length,
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
