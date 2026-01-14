/**
 * Encrypted content storage for gift wraps and seals (NIP-59)
 *
 * This implements the EncryptedContentCache interface expected by
 * applesauce's persistEncryptedContent helper.
 *
 * Storage format:
 * - Key: event.id (the gift wrap or seal event ID)
 * - Value: decrypted content string (the JSON string from decryption)
 */
import db from "./db";
import type { EncryptedContentCache } from "applesauce-common/helpers";

/**
 * Dexie-backed encrypted content storage
 * Implements applesauce's EncryptedContentCache interface
 */
export const encryptedContentStorage: EncryptedContentCache = {
  async getItem(key: string): Promise<string | null> {
    const entry = await db.encryptedContent.get(key);
    return entry?.content ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    await db.encryptedContent.put({
      id: key,
      content: value,
      cachedAt: Date.now(),
    });
  },
};

/**
 * Check if we have cached encrypted content for an event
 */
export async function hasEncryptedContent(eventId: string): Promise<boolean> {
  const count = await db.encryptedContent.where("id").equals(eventId).count();
  return count > 0;
}

/**
 * Get count of cached encrypted content entries
 */
export async function getEncryptedContentCount(): Promise<number> {
  return db.encryptedContent.count();
}

/**
 * Clear all cached encrypted content
 */
export async function clearEncryptedContent(): Promise<void> {
  await db.encryptedContent.clear();
}
