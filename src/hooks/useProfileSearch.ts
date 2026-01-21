import { useMemo } from "react";
import profileSearch, {
  type ProfileSearchResult,
} from "@/services/profile-search";

/**
 * Hook to provide profile search functionality.
 * Uses the singleton ProfileSearchService which auto-initializes
 * from IndexedDB and subscribes to EventStore.
 */
export function useProfileSearch() {
  // Memoize search function
  const searchProfiles = useMemo(
    () =>
      async (query: string): Promise<ProfileSearchResult[]> => {
        return await profileSearch.search(query, { limit: 20 });
      },
    [],
  );

  return {
    searchProfiles,
    service: profileSearch,
  };
}
