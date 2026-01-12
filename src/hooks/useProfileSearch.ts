import { useEffect, useMemo, useRef } from "react";
import {
  ProfileSearchService,
  type ProfileSearchResult,
} from "@/services/profile-search";
import eventStore from "@/services/event-store";

/**
 * Hook to provide profile search functionality with automatic indexing
 * of profiles from the event store
 */
export function useProfileSearch() {
  const serviceRef = useRef<ProfileSearchService | null>(null);

  // Create service instance (singleton per component mount)
  if (!serviceRef.current) {
    serviceRef.current = new ProfileSearchService();
  }

  const service = serviceRef.current;

  // Subscribe to profile events from the event store
  useEffect(() => {
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
  }, [service]);

  // Memoize search function
  const searchProfiles = useMemo(
    () =>
      async (query: string): Promise<ProfileSearchResult[]> => {
        return await service.search(query, { limit: 20 });
      },
    [service],
  );

  return {
    searchProfiles,
    service,
  };
}
