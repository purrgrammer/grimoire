import { useEffect, useMemo, useRef } from "react";
import type { Observable } from "rxjs";
import {
  ProfileSearchService,
  type ProfileSearchResult,
} from "@/services/profile-search";
import eventStore from "@/services/event-store";
import type { NostrEvent } from "@/types/nostr";

export interface UseProfileSearchOptions {
  /** Initial profiles to index immediately */
  initialProfiles?: NostrEvent[];
  /** Custom observable source for profiles (replaces default EventStore subscription) */
  profileSource$?: Observable<NostrEvent[]>;
  /** Whether to also include profiles from global EventStore (default: true) */
  includeGlobal?: boolean;
  /** Maximum results to return (default: 20) */
  limit?: number;
}

/**
 * Hook to provide profile search functionality with automatic indexing
 * of profiles from the event store.
 *
 * Supports injectable sources for custom profile sets (e.g., group members only).
 *
 * @example
 * // Default: index all profiles from global EventStore
 * const { searchProfiles } = useProfileSearch();
 *
 * @example
 * // Custom source: only group members
 * const { searchProfiles } = useProfileSearch({
 *   profileSource$: groupMemberProfiles$,
 *   includeGlobal: false,
 * });
 *
 * @example
 * // Pre-populate with known profiles
 * const { searchProfiles } = useProfileSearch({
 *   initialProfiles: knownProfiles,
 * });
 */
export function useProfileSearch(options: UseProfileSearchOptions = {}) {
  const {
    initialProfiles,
    profileSource$,
    includeGlobal = true,
    limit = 20,
  } = options;

  const serviceRef = useRef<ProfileSearchService | null>(null);

  // Create service instance (singleton per component mount)
  if (!serviceRef.current) {
    serviceRef.current = new ProfileSearchService();
    // Index initial profiles immediately if provided
    if (initialProfiles && initialProfiles.length > 0) {
      serviceRef.current.addProfiles(initialProfiles);
    }
  }

  const service = serviceRef.current;

  // Subscribe to custom profile source if provided
  useEffect(() => {
    if (!profileSource$) return;

    const subscription = profileSource$.subscribe({
      next: (events) => {
        service.addProfiles(events);
      },
      error: (error) => {
        console.error("Failed to load profiles from custom source:", error);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [profileSource$, service]);

  // Subscribe to global profile events from the event store
  useEffect(() => {
    if (!includeGlobal) return;

    const subscription = eventStore
      .timeline([{ kinds: [0], limit: 1000 }])
      .subscribe({
        next: (events) => {
          service.addProfiles(events);
        },
        error: (error) => {
          console.error("Failed to load profiles for search:", error);
        },
      });

    return () => {
      subscription.unsubscribe();
      service.clear(); // Clean up indexed profiles
    };
  }, [service, includeGlobal]);

  // Memoize search function
  const searchProfiles = useMemo(
    () =>
      async (query: string): Promise<ProfileSearchResult[]> => {
        return await service.search(query, { limit });
      },
    [service, limit],
  );

  return {
    searchProfiles,
    service,
  };
}
