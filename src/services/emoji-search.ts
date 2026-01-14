import { Index } from "flexsearch";
import type { NostrEvent } from "nostr-tools";
import { getEmojiTags } from "@/lib/emoji-helpers";
import type { EmojiCategory } from "@/lib/unicode-emojis";

export interface EmojiSearchResult {
  shortcode: string;
  url: string;
  /** Source of the emoji: "unicode", "user", "set:<identifier>", or "context" */
  source: string;
  /** Category of the emoji (for unicode emojis) */
  category?: EmojiCategory;
  /** Keywords for searching */
  keywords?: string[];
}

export class EmojiSearchService {
  private index: Index;
  private emojis: Map<string, EmojiSearchResult>;

  constructor() {
    this.emojis = new Map();
    this.index = new Index({
      tokenize: "forward",
      cache: true,
      resolution: 9,
    });
  }

  /**
   * Add a single emoji to the search index
   */
  async addEmoji(
    shortcode: string,
    url: string,
    source: string = "custom",
    category?: EmojiCategory,
    keywords?: string[],
  ): Promise<void> {
    // Normalize shortcode (lowercase, no colons)
    const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");

    // Don't overwrite user emoji with other sources
    const existing = this.emojis.get(normalized);
    if (existing && existing.source === "user" && source !== "user") {
      return;
    }

    const emoji: EmojiSearchResult = {
      shortcode: normalized,
      url,
      source,
      category,
      keywords,
    };

    this.emojis.set(normalized, emoji);

    // Index both shortcode and keywords for search
    const searchText = [normalized, ...(keywords || [])].join(" ");
    await this.index.addAsync(normalized, searchText);
  }

  /**
   * Add emojis from an emoji set event (kind 30030)
   */
  async addEmojiSet(event: NostrEvent): Promise<void> {
    if (event.kind !== 30030) return;

    const identifier =
      event.tags.find((t) => t[0] === "d")?.[1] || "unnamed-set";
    const emojis = getEmojiTags(event);

    for (const emoji of emojis) {
      await this.addEmoji(emoji.shortcode, emoji.url, `set:${identifier}`);
    }
  }

  /**
   * Add emojis from user's emoji list (kind 10030)
   */
  async addUserEmojiList(event: NostrEvent): Promise<void> {
    if (event.kind !== 10030) return;

    const emojis = getEmojiTags(event);

    for (const emoji of emojis) {
      await this.addEmoji(emoji.shortcode, emoji.url, "user");
    }
  }

  /**
   * Add context emojis from an event being replied to
   */
  async addContextEmojis(event: NostrEvent): Promise<void> {
    const emojis = getEmojiTags(event);

    for (const emoji of emojis) {
      await this.addEmoji(emoji.shortcode, emoji.url, "context");
    }
  }

  /**
   * Add multiple Unicode emojis
   */
  async addUnicodeEmojis(
    emojis: Array<{
      shortcode: string;
      emoji: string;
      category?: EmojiCategory;
      keywords?: string[];
    }>,
  ): Promise<void> {
    for (const { shortcode, emoji, category, keywords } of emojis) {
      // For Unicode emoji, the "url" is actually the emoji character
      // We'll handle this specially in the UI
      await this.addEmoji(shortcode, emoji, "unicode", category, keywords);
    }
  }

  /**
   * Get emojis by category
   */
  getByCategory(category: EmojiCategory): EmojiSearchResult[] {
    return Array.from(this.emojis.values()).filter(
      (e) => e.category === category,
    );
  }

  /**
   * Get all available categories with emoji counts
   */
  getCategories(): Array<{ category: EmojiCategory; count: number }> {
    const counts = new Map<EmojiCategory, number>();
    for (const emoji of this.emojis.values()) {
      if (emoji.category) {
        counts.set(emoji.category, (counts.get(emoji.category) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).map(([category, count]) => ({
      category,
      count,
    }));
  }

  /**
   * Search emojis by shortcode and keywords
   */
  async search(
    query: string,
    options: { limit?: number; category?: EmojiCategory } = {},
  ): Promise<EmojiSearchResult[]> {
    const { limit = 24 } = options;

    // Normalize query
    const normalizedQuery = query.toLowerCase().replace(/^:|:$/g, "");

    if (!normalizedQuery.trim()) {
      // Return recent/popular emojis when no query
      // Prioritize user emojis, then sets, then unicode
      const items = Array.from(this.emojis.values())
        .sort((a, b) => {
          const priority = { user: 0, context: 1, unicode: 3 };
          const aPriority = a.source.startsWith("set:")
            ? 2
            : (priority[a.source as keyof typeof priority] ?? 2);
          const bPriority = b.source.startsWith("set:")
            ? 2
            : (priority[b.source as keyof typeof priority] ?? 2);
          return aPriority - bPriority;
        })
        .slice(0, limit);
      return items;
    }

    // Search index
    const ids = (await this.index.searchAsync(normalizedQuery, {
      limit: limit * 2, // Get more results to filter by category
    })) as string[];

    // Map IDs to emojis and filter by category if specified
    let items = ids
      .map((id) => this.emojis.get(id))
      .filter(Boolean) as EmojiSearchResult[];

    if (options.category) {
      items = items.filter((e) => e.category === options.category);
    }

    return items.slice(0, limit);
  }

  /**
   * Get emoji by shortcode
   */
  getByShortcode(shortcode: string): EmojiSearchResult | undefined {
    const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");
    return this.emojis.get(normalized);
  }

  /**
   * Clear all emojis
   */
  clear(): void {
    this.emojis.clear();
    this.index = new Index({
      tokenize: "forward",
      cache: true,
      resolution: 9,
    });
  }

  /**
   * Clear only custom emojis (keep unicode)
   */
  clearCustom(): void {
    const unicodeEmojis = Array.from(this.emojis.values()).filter(
      (e) => e.source === "unicode",
    );
    this.clear();
    // Re-add unicode emojis
    for (const emoji of unicodeEmojis) {
      this.addEmoji(emoji.shortcode, emoji.url, "unicode");
    }
  }

  /**
   * Get total number of indexed emojis
   */
  get size(): number {
    return this.emojis.size;
  }
}
