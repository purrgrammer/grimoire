import { Index } from "flexsearch";
import type { NostrEvent } from "nostr-tools";
import { getProfileContent } from "applesauce-core/helpers";
import { getDisplayName } from "@/lib/nostr-utils";

export interface ProfileSearchResult {
  pubkey: string;
  displayName: string;
  username?: string;
  nip05?: string;
  picture?: string;
  event?: NostrEvent;
}

export class ProfileSearchService {
  private index: Index;
  private profiles: Map<string, ProfileSearchResult>;

  constructor() {
    this.profiles = new Map();
    this.index = new Index({
      tokenize: "forward",
      cache: true,
      resolution: 9,
    });
  }

  /**
   * Add a profile to the search index
   */
  async addProfile(event: NostrEvent): Promise<void> {
    if (event.kind !== 0) return;

    const pubkey = event.pubkey;
    const metadata = getProfileContent(event);

    const profile: ProfileSearchResult = {
      pubkey,
      displayName: getDisplayName(pubkey, metadata),
      username: metadata?.name,
      nip05: metadata?.nip05,
      picture: metadata?.picture,
      event,
    };

    this.profiles.set(pubkey, profile);

    // Create searchable text from multiple fields (lowercase for case-insensitive search)
    const searchText = [
      profile.displayName,
      profile.username,
      profile.nip05,
      pubkey,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    await this.index.addAsync(pubkey, searchText);
  }

  /**
   * Add multiple profiles in batch
   */
  async addProfiles(events: NostrEvent[]): Promise<void> {
    for (const event of events) {
      await this.addProfile(event);
    }
  }

  /**
   * Remove a profile from the search index
   */
  async removeProfile(pubkey: string): Promise<void> {
    this.profiles.delete(pubkey);
    await this.index.removeAsync(pubkey);
  }

  /**
   * Search profiles by query string
   */
  async search(
    query: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<ProfileSearchResult[]> {
    const { limit = 10, offset = 0 } = options;

    if (!query.trim()) {
      // Return recent profiles when no query
      const items = Array.from(this.profiles.values()).slice(
        offset,
        offset + limit,
      );
      return items;
    }

    // Search index (lowercase for case-insensitive search)
    const ids = (await this.index.searchAsync(query.toLowerCase(), {
      limit: limit + offset,
    })) as string[];

    // Map IDs to profiles
    const items = ids
      .slice(offset, offset + limit)
      .map((id) => this.profiles.get(id))
      .filter(Boolean) as ProfileSearchResult[];

    return items;
  }

  /**
   * Get profile by pubkey
   */
  getByPubkey(pubkey: string): ProfileSearchResult | undefined {
    return this.profiles.get(pubkey);
  }

  /**
   * Clear all profiles
   */
  clear(): void {
    this.profiles.clear();
    this.index = new Index({
      tokenize: "forward",
      cache: true,
      resolution: 9,
    });
  }

  /**
   * Get total number of indexed profiles
   */
  get size(): number {
    return this.profiles.size;
  }
}
