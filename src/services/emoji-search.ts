import { Index } from "flexsearch";
import type { NostrEvent } from "nostr-tools";
import type { IEventStore } from "applesauce-core/event-store";
import type { Subscription } from "rxjs";
import { firstValueFrom } from "rxjs";
import { filter, timeout } from "rxjs/operators";
import { getEmojiTags } from "@/lib/emoji-helpers";
import { UNICODE_EMOJIS, EMOJI_KEYWORDS } from "@/lib/unicode-emojis";
import { emojiSetCache } from "./emoji-set-cache";
import { getRecentEmojiKeys } from "./emoji-usage";

export interface EmojiSearchResult {
  shortcode: string;
  url: string;
  /** Source of the emoji: "unicode", "user", "set:<identifier>", or "context" */
  source: string;
  /** NIP-30 optional 4th tag: "30030:pubkey:identifier" address of the emoji set */
  address?: string;
}

export class EmojiSearchService {
  private index: Index;
  private emojis: Map<string, EmojiSearchResult>;

  // Subscription management — only one open sub (kind 10030)
  private userListSub: Subscription | null = null;
  private trackedSetAddresses = new Set<string>();
  private currentPubkey: string | null = null;
  private eventStore: IEventStore | null = null;

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
    address?: string,
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
      address,
    };

    this.emojis.set(normalized, emoji);
    await this.index.addAsync(normalized, normalized);
  }

  /**
   * Add emojis from an emoji set event (kind 30030)
   */
  async addEmojiSet(event: NostrEvent): Promise<void> {
    if (event.kind !== 30030) return;

    const identifier =
      event.tags.find((t) => t[0] === "d")?.[1] || "unnamed-set";
    const address = `30030:${event.pubkey}:${identifier}`;
    const emojis = getEmojiTags(event);

    for (const emoji of emojis) {
      await this.addEmoji(
        emoji.shortcode,
        emoji.url,
        `set:${identifier}`,
        address,
      );
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
   * Add multiple Unicode emojis with keyword-enriched search indexing.
   * Keywords from emojilib are joined into the indexed string so that
   * searching "happy" finds 😀, "animal" finds 🐶, etc.
   */
  addUnicodeEmojis(
    emojis: Array<{ shortcode: string; emoji: string }>,
    keywords?: Record<string, string[]>,
  ): void {
    for (const { shortcode, emoji } of emojis) {
      const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");

      const emojiResult: EmojiSearchResult = {
        shortcode: normalized,
        url: emoji,
        source: "unicode",
      };

      this.emojis.set(normalized, emojiResult);

      // Build search string: shortcode + emojilib keywords for richer matching
      const emojiKeywords = keywords?.[emoji];
      const searchText = emojiKeywords
        ? `${normalized} ${emojiKeywords.join(" ")}`
        : normalized;

      this.index.add(normalized, searchText);
    }
  }

  /**
   * Load cached emojis from Dexie for immediate availability.
   * Called before relay subscriptions so emojis are usable instantly.
   */
  async loadCachedForUser(pubkey: string): Promise<void> {
    // Load cached user emoji list (kind 10030)
    const cachedList = await emojiSetCache.getUserEmojiList(pubkey);
    if (cachedList) {
      // Add inline emojis from the user's list
      for (const emoji of cachedList.emojis) {
        await this.addEmoji(emoji.shortcode, emoji.url, "user");
      }

      // Load all referenced emoji sets in bulk
      if (cachedList.setAddresses.length > 0) {
        const cachedSets = await emojiSetCache.getEmojiSetsForAddresses(
          cachedList.setAddresses,
        );
        for (const cachedSet of cachedSets) {
          const identifier = cachedSet.address.split(":")[2] || "unnamed-set";
          for (const emoji of cachedSet.emojis) {
            await this.addEmoji(
              emoji.shortcode,
              emoji.url,
              `set:${identifier}`,
              cachedSet.address,
            );
          }
        }
      }
    }

    console.debug(
      `[EmojiSearch] Loaded ${this.emojis.size} emojis from cache for ${pubkey.slice(0, 8)}`,
    );
  }

  /**
   * Subscribe to EventStore for live emoji updates.
   * Only keeps one open subscription (kind 10030 user emoji list).
   * Referenced emoji sets are fetched once when the list changes.
   */
  subscribeForUser(pubkey: string, eventStore: IEventStore): void {
    if (this.currentPubkey === pubkey) return;

    // Clean up any existing subscriptions
    this.unsubscribeUser();
    this.currentPubkey = pubkey;
    this.eventStore = eventStore;

    // Subscribe to user's emoji list (kind 10030) — the only open subscription
    const userEmojiList$ = eventStore.replaceable(10030, pubkey);
    this.userListSub = userEmojiList$.subscribe({
      next: (event) => {
        if (!event) return;

        this.addUserEmojiList(event);
        emojiSetCache.setUserEmojiList(event);

        // Diff "a" tags to incrementally fetch new emoji sets
        const newAddresses = new Set(
          event.tags
            .filter((t) => t[0] === "a" && t[1]?.startsWith("30030:"))
            .map((t) => t[1]),
        );

        // Fetch only newly-referenced sets (one-shot, no persistent sub)
        for (const address of newAddresses) {
          if (!this.trackedSetAddresses.has(address)) {
            this.fetchEmojiSet(address);
          }
        }

        this.trackedSetAddresses = newAddresses;
      },
      error: (error) => {
        console.error("[EmojiSearch] Failed to load user emoji list:", error);
      },
    });
  }

  /**
   * One-shot fetch of an emoji set by address coordinate.
   * Loads from EventStore (which triggers the address loader if missing),
   * indexes the emojis, and caches to Dexie. No persistent subscription.
   */
  private async fetchEmojiSet(address: string): Promise<void> {
    if (!this.eventStore) return;

    const parts = address.split(":");
    if (parts.length < 3) return;

    const [kind, setPubkey, identifier] = parts;
    if (!kind || !setPubkey || identifier === undefined) return;

    try {
      const setEvent = await firstValueFrom(
        this.eventStore
          .replaceable(parseInt(kind, 10), setPubkey, identifier)
          .pipe(
            filter((e): e is NostrEvent => e !== undefined),
            timeout(15_000),
          ),
      );

      this.addEmojiSet(setEvent);
      emojiSetCache.setEmojiSet(setEvent);
    } catch {
      // Observable completed without emitting — set not found on relays
      console.debug(`[EmojiSearch] Emoji set not found: ${address}`);
    }
  }

  /**
   * Tear down relay subscription and clear custom emojis
   */
  unsubscribeUser(): void {
    if (this.userListSub) {
      this.userListSub.unsubscribe();
      this.userListSub = null;
    }

    this.trackedSetAddresses.clear();
    this.currentPubkey = null;
    this.eventStore = null;

    this.clearCustom();
  }

  /**
   * Search emojis by shortcode
   */
  async search(
    query: string,
    options: { limit?: number } = {},
  ): Promise<EmojiSearchResult[]> {
    const { limit = 24 } = options;

    // Normalize query
    const normalizedQuery = query.toLowerCase().replace(/^:|:$/g, "");

    if (!normalizedQuery.trim()) {
      // Show recently-used emojis first, then fill with source-priority order
      const recentKeys = getRecentEmojiKeys(limit);
      const results: EmojiSearchResult[] = [];
      const included = new Set<string>();

      // Resolve recent keys to indexed emojis
      for (const key of recentKeys) {
        let result: EmojiSearchResult | undefined;
        if (key.startsWith(":") && key.endsWith(":")) {
          result = this.emojis.get(key.slice(1, -1));
        } else {
          // Unicode: key is the emoji character, stored as `url`
          for (const emoji of this.emojis.values()) {
            if (emoji.source === "unicode" && emoji.url === key) {
              result = emoji;
              break;
            }
          }
        }
        if (result) {
          results.push(result);
          included.add(result.shortcode);
        }
      }

      // Fill remaining slots with source-priority sorted emojis
      if (results.length < limit) {
        const sourcePriority: Record<string, number> = {
          user: 0,
          context: 1,
          unicode: 3,
        };
        const remaining = Array.from(this.emojis.values())
          .filter((e) => !included.has(e.shortcode))
          .sort((a, b) => {
            const aPriority = a.source.startsWith("set:")
              ? 2
              : (sourcePriority[a.source] ?? 2);
            const bPriority = b.source.startsWith("set:")
              ? 2
              : (sourcePriority[b.source] ?? 2);
            return aPriority - bPriority;
          })
          .slice(0, limit - results.length);
        results.push(...remaining);
      }

      return results;
    }

    // Search index
    const ids = (await this.index.searchAsync(normalizedQuery, {
      limit,
    })) as string[];

    // Map IDs to emojis
    const items = ids
      .map((id) => this.emojis.get(id))
      .filter(Boolean) as EmojiSearchResult[];

    return items;
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
   * Clear only custom emojis (keep unicode).
   * Re-indexes unicode emojis synchronously with keyword-enriched search.
   */
  clearCustom(): void {
    this.clear();
    this.addUnicodeEmojis(UNICODE_EMOJIS, EMOJI_KEYWORDS);
  }

  /**
   * Get total number of indexed emojis
   */
  get size(): number {
    return this.emojis.size;
  }
}

// Singleton instance with Unicode emojis pre-loaded (with keyword-enriched search)
const emojiSearchService = new EmojiSearchService();
emojiSearchService.addUnicodeEmojis(UNICODE_EMOJIS, EMOJI_KEYWORDS);

export default emojiSearchService;
