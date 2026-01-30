import { firstValueFrom } from "rxjs";
import { first } from "rxjs/operators";
import { kinds, type Filter } from "nostr-tools";
import {
  getProfileContent,
  getOrComputeCachedValue,
} from "applesauce-core/helpers";
import { profileLoader } from "@/services/loaders";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import type { NostrEvent } from "@/types/nostr";

// Symbol for caching extracted metadata on event objects
const GroupMetadataSymbol = Symbol("groupMetadata");

/**
 * Resolved group metadata
 */
export interface GroupMetadata {
  name: string;
  description?: string;
  icon?: string;
  source: "nip29" | "profile" | "fallback";
}

/**
 * Check if a string is a valid nostr pubkey (64 character hex string)
 */
function isValidPubkey(str: string): boolean {
  return /^[0-9a-f]{64}$/i.test(str);
}

/**
 * Extract metadata from a kind 39000 event with caching
 */
function extractFromEvent(groupId: string, event: NostrEvent): GroupMetadata {
  return getOrComputeCachedValue(event, GroupMetadataSymbol, () => {
    const name = event.tags.find((t) => t[0] === "name")?.[1] || groupId;
    const description = event.tags.find((t) => t[0] === "about")?.[1];
    const icon = event.tags.find((t) => t[0] === "picture")?.[1];

    return {
      name,
      description,
      icon,
      source: "nip29" as const,
    };
  });
}

/**
 * Singleton cache for NIP-29 group metadata
 *
 * Provides a shared cache between GroupListViewer and NIP-29 adapter.
 * Checks eventStore first, then fetches from relay if needed.
 */
class GroupMetadataCache {
  // In-memory cache: "relayUrl'groupId" -> metadata
  private cache = new Map<string, GroupMetadata>();

  /**
   * Get cache key for a group
   */
  getKey(relayUrl: string, groupId: string): string {
    return `${relayUrl}'${groupId}`;
  }

  /**
   * Get metadata from cache (sync, returns undefined if not cached)
   */
  get(relayUrl: string, groupId: string): GroupMetadata | undefined {
    return this.cache.get(this.getKey(relayUrl, groupId));
  }

  /**
   * Set metadata in cache
   */
  set(relayUrl: string, groupId: string, metadata: GroupMetadata): void {
    this.cache.set(this.getKey(relayUrl, groupId), metadata);
  }

  /**
   * Check eventStore for cached kind 39000 event and extract metadata
   * Returns undefined if not in store
   */
  async getFromEventStore(
    groupId: string,
  ): Promise<{ event: NostrEvent; metadata: GroupMetadata } | undefined> {
    const events = await firstValueFrom(
      eventStore
        .timeline([{ kinds: [39000], "#d": [groupId], limit: 1 }])
        .pipe(first()),
      { defaultValue: [] },
    );

    const event = events[0];
    if (event && event.kind === 39000) {
      const metadata = extractFromEvent(groupId, event);
      return { event, metadata };
    }

    return undefined;
  }

  /**
   * Fetch metadata from relay (adds to eventStore automatically)
   */
  async fetchFromRelay(
    relayUrl: string,
    groupId: string,
    timeoutMs = 5000,
  ): Promise<NostrEvent | undefined> {
    const filter: Filter = {
      kinds: [39000],
      "#d": [groupId],
      limit: 1,
    };

    const events: NostrEvent[] = [];
    const subscription = pool.subscription([relayUrl], [filter], {
      eventStore,
    });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`[GroupMetadataCache] Fetch timeout for ${groupId}`);
        resolve();
      }, timeoutMs);

      const sub = subscription.subscribe({
        next: (response) => {
          if (typeof response === "string") {
            // EOSE
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } else {
            events.push(response);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          console.error(`[GroupMetadataCache] Fetch error:`, err);
          sub.unsubscribe();
          resolve();
        },
      });
    });

    return events[0];
  }

  /**
   * Resolve profile metadata for pubkey-based group IDs
   */
  async resolveProfileFallback(
    groupId: string,
    relayUrl: string,
  ): Promise<GroupMetadata | undefined> {
    if (!isValidPubkey(groupId)) {
      return undefined;
    }

    try {
      const profileEvent = await firstValueFrom(
        profileLoader({
          kind: kinds.Metadata,
          pubkey: groupId,
          relays: [relayUrl],
        }),
        { defaultValue: undefined },
      );

      if (profileEvent) {
        const content = getProfileContent(profileEvent);
        if (content) {
          return {
            name:
              content.display_name ||
              content.name ||
              `${groupId.slice(0, 8)}:${groupId.slice(-8)}`,
            description: content.about,
            icon: content.picture,
            source: "profile",
          };
        }
      }
    } catch (error) {
      console.warn(
        `[GroupMetadataCache] Profile fallback failed for ${groupId.slice(0, 8)}:`,
        error,
      );
    }

    return undefined;
  }

  /**
   * Get or fetch metadata for a group
   *
   * Priority:
   * 1. In-memory cache
   * 2. EventStore (kind 39000)
   * 3. Fetch from relay
   * 4. Profile fallback (if groupId is a pubkey)
   * 5. Fallback to groupId as name
   */
  async resolve(
    relayUrl: string,
    groupId: string,
    options?: { skipFetch?: boolean },
  ): Promise<GroupMetadata> {
    const key = this.getKey(relayUrl, groupId);

    // 1. Check in-memory cache
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    // 2. Check eventStore
    const fromStore = await this.getFromEventStore(groupId);
    if (fromStore) {
      this.cache.set(key, fromStore.metadata);
      return fromStore.metadata;
    }

    // 3. Fetch from relay (unless skipped)
    if (!options?.skipFetch) {
      console.log(`[GroupMetadataCache] Fetching ${groupId} from ${relayUrl}`);
      const event = await this.fetchFromRelay(relayUrl, groupId);
      if (event) {
        const metadata = extractFromEvent(groupId, event);
        this.cache.set(key, metadata);
        return metadata;
      }
    }

    // 4. Try profile fallback for pubkey-based groups
    const profileMetadata = await this.resolveProfileFallback(
      groupId,
      relayUrl,
    );
    if (profileMetadata) {
      this.cache.set(key, profileMetadata);
      return profileMetadata;
    }

    // 5. Fallback
    const fallback: GroupMetadata = {
      name: groupId,
      source: "fallback",
    };
    this.cache.set(key, fallback);
    return fallback;
  }

  /**
   * Sync resolve from cache or eventStore (no network)
   * Returns undefined if not available
   */
  getSync(relayUrl: string, groupId: string): GroupMetadata | undefined {
    // Check in-memory cache first
    const cached = this.get(relayUrl, groupId);
    if (cached) {
      return cached;
    }

    // Can't do sync eventStore query, return undefined
    return undefined;
  }

  /**
   * Update cache from a kind 39000 event
   * Called when events are received via subscription
   */
  updateFromEvent(
    relayUrl: string,
    event: NostrEvent,
  ): GroupMetadata | undefined {
    if (event.kind !== 39000) return undefined;

    const groupId = event.tags.find((t) => t[0] === "d")?.[1];
    if (!groupId) return undefined;

    const metadata = extractFromEvent(groupId, event);
    this.set(relayUrl, groupId, metadata);
    return metadata;
  }

  /**
   * Clear cache (useful for testing)
   */
  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance
const groupMetadataCache = new GroupMetadataCache();

export default groupMetadataCache;
