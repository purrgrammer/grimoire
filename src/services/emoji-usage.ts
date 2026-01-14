/**
 * Service for tracking frequently used emojis via localStorage
 */

const STORAGE_KEY = "grimoire:emoji-usage";
const MAX_TRACKED = 50; // Maximum number of emojis to track

export interface EmojiUsage {
  shortcode: string;
  count: number;
  lastUsed: number; // timestamp
}

export class EmojiUsageService {
  private usage: Map<string, EmojiUsage>;

  constructor() {
    this.usage = new Map();
    this.load();
  }

  /**
   * Load usage data from localStorage
   */
  private load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data: EmojiUsage[] = JSON.parse(stored);
        this.usage = new Map(data.map((item) => [item.shortcode, item]));
      }
    } catch (error) {
      console.error("[EmojiUsageService] Failed to load usage data:", error);
    }
  }

  /**
   * Save usage data to localStorage
   */
  private save(): void {
    try {
      const data = Array.from(this.usage.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("[EmojiUsageService] Failed to save usage data:", error);
    }
  }

  /**
   * Record usage of an emoji
   */
  recordUsage(shortcode: string): void {
    const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");
    const existing = this.usage.get(normalized);

    if (existing) {
      existing.count += 1;
      existing.lastUsed = Date.now();
    } else {
      this.usage.set(normalized, {
        shortcode: normalized,
        count: 1,
        lastUsed: Date.now(),
      });
    }

    // Prune old entries if we exceed max tracked
    if (this.usage.size > MAX_TRACKED) {
      this.prune();
    }

    this.save();
  }

  /**
   * Get frequently used emojis sorted by usage count and recency
   */
  getFrequentlyUsed(limit: number = 24): string[] {
    const items = Array.from(this.usage.values());

    // Sort by usage count (descending), then by recency (descending)
    items.sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return b.lastUsed - a.lastUsed;
    });

    return items.slice(0, limit).map((item) => item.shortcode);
  }

  /**
   * Check if an emoji has been used recently
   */
  hasBeenUsed(shortcode: string): boolean {
    const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");
    return this.usage.has(normalized);
  }

  /**
   * Get usage count for an emoji
   */
  getUsageCount(shortcode: string): number {
    const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");
    return this.usage.get(normalized)?.count || 0;
  }

  /**
   * Prune least used emojis to keep under MAX_TRACKED
   */
  private prune(): void {
    const items = Array.from(this.usage.values());

    // Sort by usage count (ascending), then by recency (ascending)
    items.sort((a, b) => {
      if (a.count !== b.count) {
        return a.count - b.count;
      }
      return a.lastUsed - b.lastUsed;
    });

    // Remove oldest/least used items
    const toRemove = items.slice(0, items.length - MAX_TRACKED);
    for (const item of toRemove) {
      this.usage.delete(item.shortcode);
    }
  }

  /**
   * Clear all usage data
   */
  clear(): void {
    this.usage.clear();
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Get total number of tracked emojis
   */
  get size(): number {
    return this.usage.size;
  }
}

// Create singleton instance
let instance: EmojiUsageService | null = null;

export function getEmojiUsageService(): EmojiUsageService {
  if (!instance) {
    instance = new EmojiUsageService();
  }
  return instance;
}
