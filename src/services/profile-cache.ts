import type { NostrEvent } from "nostr-tools";
import {
  getProfileContent,
  type ProfileContent,
} from "applesauce-core/helpers";
import eventStore from "./event-store";
import db from "./db";

/**
 * Simple singleton profile cache for synchronous display name lookups.
 * Used by paste handlers and other places that need instant profile access.
 */
class ProfileCache {
  private profiles = new Map<string, ProfileContent>();
  private initialized = false;

  /**
   * Initialize the cache by:
   * 1. Loading profiles from Dexie (IndexedDB)
   * 2. Subscribing to EventStore for new kind 0 events
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Load from Dexie first (persisted profiles)
    try {
      const cachedProfiles = await db.profiles.toArray();
      for (const profile of cachedProfiles) {
        const { pubkey, created_at: _created_at, ...content } = profile;
        this.profiles.set(pubkey, content as ProfileContent);
      }
      console.debug(
        `[ProfileCache] Loaded ${cachedProfiles.length} profiles from IndexedDB`,
      );
    } catch (err) {
      console.warn("[ProfileCache] Failed to load from IndexedDB:", err);
    }

    // Subscribe to EventStore for new kind 0 events
    eventStore.timeline([{ kinds: [0] }]).subscribe({
      next: (events) => {
        for (const event of events) {
          this.addFromEvent(event);
        }
      },
      error: (err) => {
        console.warn("[ProfileCache] EventStore subscription error:", err);
      },
    });
  }

  /**
   * Add a profile from a kind 0 event
   */
  addFromEvent(event: NostrEvent): void {
    if (event.kind !== 0) return;

    const content = getProfileContent(event);
    if (content) {
      this.profiles.set(event.pubkey, content);
    }
  }

  /**
   * Get profile content for a pubkey (synchronous)
   */
  get(pubkey: string): ProfileContent | undefined {
    return this.profiles.get(pubkey);
  }

  /**
   * Check if a profile is cached
   */
  has(pubkey: string): boolean {
    return this.profiles.has(pubkey);
  }

  /**
   * Get the number of cached profiles
   */
  get size(): number {
    return this.profiles.size;
  }
}

// Singleton instance
const profileCache = new ProfileCache();

// Auto-initialize on module load
profileCache.init();

export default profileCache;
