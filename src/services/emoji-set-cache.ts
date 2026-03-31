/**
 * Emoji Set Cache Service
 *
 * Caches user emoji lists (kind:10030) and emoji sets (kind:30030) in Dexie
 * for instant availability on startup. Relay subscriptions update the cache
 * as fresh data arrives.
 */

import type { NostrEvent } from "@/types/nostr";
import { getEmojiTags } from "@/lib/emoji-helpers";
import db, { type CachedUserEmojiList, type CachedEmojiSet } from "./db";

class EmojiSetCache {
  /**
   * Get cached user emoji list (kind 10030)
   */
  async getUserEmojiList(
    pubkey: string,
  ): Promise<CachedUserEmojiList | undefined> {
    try {
      return await db.userEmojiLists.get(pubkey);
    } catch (error) {
      console.error(
        `[EmojiSetCache] Error reading user emoji list for ${pubkey.slice(0, 8)}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Cache a user emoji list event (kind 10030)
   */
  async setUserEmojiList(event: NostrEvent): Promise<void> {
    try {
      if (event.kind !== 10030) return;

      const emojis = getEmojiTags(event).map((e) => ({
        shortcode: e.shortcode,
        url: e.url,
      }));

      const setAddresses = event.tags
        .filter((t) => t[0] === "a" && t[1]?.startsWith("30030:"))
        .map((t) => t[1]);

      const entry: CachedUserEmojiList = {
        pubkey: event.pubkey,
        event,
        emojis,
        setAddresses,
        updatedAt: Date.now(),
      };

      await db.userEmojiLists.put(entry);
    } catch (error) {
      console.error(
        `[EmojiSetCache] Error caching user emoji list for ${event.pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Get a cached emoji set (kind 30030)
   */
  async getEmojiSet(address: string): Promise<CachedEmojiSet | undefined> {
    try {
      return await db.emojiSets.get(address);
    } catch (error) {
      console.error(
        `[EmojiSetCache] Error reading emoji set ${address}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Cache an emoji set event (kind 30030)
   */
  async setEmojiSet(event: NostrEvent): Promise<void> {
    try {
      if (event.kind !== 30030) return;

      const identifier =
        event.tags.find((t) => t[0] === "d")?.[1] || "unnamed-set";
      const address = `30030:${event.pubkey}:${identifier}`;

      const emojis = getEmojiTags(event).map((e) => ({
        shortcode: e.shortcode,
        url: e.url,
      }));

      const entry: CachedEmojiSet = {
        address,
        event,
        emojis,
        updatedAt: Date.now(),
      };

      await db.emojiSets.put(entry);
    } catch (error) {
      console.error(`[EmojiSetCache] Error caching emoji set:`, error);
    }
  }

  /**
   * Bulk-read emoji sets by their addresses
   */
  async getEmojiSetsForAddresses(
    addresses: string[],
  ): Promise<CachedEmojiSet[]> {
    try {
      const results = await db.emojiSets.bulkGet(addresses);
      return results.filter((r): r is CachedEmojiSet => r !== undefined);
    } catch (error) {
      console.error(`[EmojiSetCache] Error bulk-reading emoji sets:`, error);
      return [];
    }
  }

  /**
   * Clear all cached emoji data
   */
  async clear(): Promise<void> {
    try {
      await db.userEmojiLists.clear();
      await db.emojiSets.clear();
    } catch (error) {
      console.error("[EmojiSetCache] Error clearing cache:", error);
    }
  }
}

export const emojiSetCache = new EmojiSetCache();
export default emojiSetCache;
