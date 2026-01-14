/**
 * Rumor storage service for caching decrypted gift wrap content
 *
 * When a gift wrap (kind 1059) is decrypted, the inner rumor is cached
 * so we don't have to decrypt it again. This is especially important
 * because decryption requires the signer (browser extension interaction).
 *
 * Storage format matches applesauce's persistEncryptedContent expectations:
 * - Key: `rumor:${giftWrapId}`
 * - Value: The decrypted rumor object
 */
import type { Rumor } from "applesauce-common/helpers";
import db, { type DecryptedRumor } from "./db";
import { BehaviorSubject, type Observable } from "rxjs";

/**
 * Current user pubkey for multi-account support
 * Set this when account changes
 */
const currentPubkey$ = new BehaviorSubject<string | null>(null);

export function setCurrentPubkey(pubkey: string | null): void {
  currentPubkey$.next(pubkey);
}

export function getCurrentPubkey(): string | null {
  return currentPubkey$.value;
}

/**
 * Storage interface compatible with applesauce's persistEncryptedContent
 *
 * The keys are in format "rumor:{giftWrapId}" or "seal:{giftWrapId}"
 */
export const rumorStorage = {
  async getItem(key: string): Promise<string | null> {
    const pubkey = currentPubkey$.value;
    if (!pubkey) return null;

    // Parse key format: "rumor:{giftWrapId}" or "seal:{giftWrapId}"
    const match = key.match(/^(rumor|seal):(.+)$/);
    if (!match) return null;

    const [, type, giftWrapId] = match;

    if (type === "rumor") {
      const entry = await db.decryptedRumors.get(giftWrapId);
      if (entry && entry.decryptedBy === pubkey) {
        return JSON.stringify(entry.rumor);
      }
    }

    // For seals, we don't cache them separately (they're intermediate)
    return null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const pubkey = currentPubkey$.value;
    if (!pubkey) return;

    // Parse key format
    const match = key.match(/^(rumor|seal):(.+)$/);
    if (!match) return;

    const [, type, giftWrapId] = match;

    if (type === "rumor") {
      const rumor = JSON.parse(value) as Rumor;
      const entry: DecryptedRumor = {
        giftWrapId,
        rumor,
        decryptedBy: pubkey,
        decryptedAt: Date.now(),
      };
      await db.decryptedRumors.put(entry);
    }

    // We don't persist seals - they're just intermediate decryption steps
  },

  async removeItem(key: string): Promise<void> {
    const match = key.match(/^(rumor|seal):(.+)$/);
    if (!match) return;

    const [, , giftWrapId] = match;
    await db.decryptedRumors.delete(giftWrapId);
  },
};

/**
 * Get all decrypted rumors for the current user
 */
export async function getDecryptedRumors(pubkey: string): Promise<Rumor[]> {
  const entries = await db.decryptedRumors
    .where("decryptedBy")
    .equals(pubkey)
    .toArray();

  return entries.map((e) => e.rumor);
}

/**
 * Get a specific decrypted rumor by gift wrap ID
 */
export async function getDecryptedRumor(
  giftWrapId: string,
  pubkey: string,
): Promise<Rumor | null> {
  const entry = await db.decryptedRumors.get(giftWrapId);
  if (entry && entry.decryptedBy === pubkey) {
    return entry.rumor;
  }
  return null;
}

/**
 * Check if a gift wrap has already been decrypted
 */
export async function isGiftWrapDecrypted(
  giftWrapId: string,
  pubkey: string,
): Promise<boolean> {
  const entry = await db.decryptedRumors.get(giftWrapId);
  return entry !== null && entry !== undefined && entry.decryptedBy === pubkey;
}

/**
 * Store a decrypted rumor directly (for manual decryption flows)
 */
export async function storeDecryptedRumor(
  giftWrapId: string,
  rumor: Rumor,
  decryptedBy: string,
): Promise<void> {
  const entry: DecryptedRumor = {
    giftWrapId,
    rumor,
    decryptedBy,
    decryptedAt: Date.now(),
  };
  await db.decryptedRumors.put(entry);
}

/**
 * Get count of decrypted rumors for a user
 */
export async function getDecryptedRumorCount(pubkey: string): Promise<number> {
  return db.decryptedRumors.where("decryptedBy").equals(pubkey).count();
}

/**
 * Clear all decrypted rumors for a user
 * Useful for "forget me" functionality
 */
export async function clearDecryptedRumors(pubkey: string): Promise<number> {
  return db.decryptedRumors.where("decryptedBy").equals(pubkey).delete();
}

/**
 * Observable storage for applesauce's persistEncryptedContent
 * Returns an observable that emits the storage when pubkey is set
 */
export function getRumorStorage$(): Observable<typeof rumorStorage | null> {
  return new BehaviorSubject(rumorStorage);
}
