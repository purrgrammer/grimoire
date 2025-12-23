import { useState, useEffect, useMemo } from "react";
import pool from "@/services/relay-pool";
import type { NostrFilter } from "@/types/nostr";
import type { FilterWithAnd } from "applesauce-core/helpers";
import { useStableValue, useStableArray } from "./useStable";

/**
 * Status for a single relay's COUNT response
 */
export type CountStatus = "loading" | "success" | "error" | "closed";

/**
 * Result from a single relay
 */
export interface CountResult {
  relay: string;
  count: number | null;
  approximate?: boolean;
  status: CountStatus;
  error?: string;
}

/**
 * Return value for useCountQuery hook
 */
export interface UseCountQueryReturn {
  results: CountResult[];
  loading: boolean;
  error: Error | null;
}

/**
 * Hook for COUNT command - queries relays for event counts using NIP-45
 *
 * @param id - Unique identifier for this count query
 * @param filter - Nostr filter object (single filter)
 * @param relays - Array of relay URLs to query
 * @returns Object containing per-relay results, loading state, and error
 *
 * @example
 * const { results, loading } = useCountQuery(
 *   'follower-count',
 *   { kinds: [3], '#p': [pubkey] },
 *   ['wss://relay.damus.io']
 * );
 */
export function useCountQuery(
  id: string,
  filter: NostrFilter,
  relays: string[],
): UseCountQueryReturn {
  const [results, setResults] = useState<CountResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Stabilize filter and relays to prevent unnecessary re-renders
  const stableFilter = useStableValue(filter);
  const stableRelays = useStableArray(relays);

  // Initialize results with loading state for all relays
  const initialResults = useMemo(() => {
    return relays.map((relay) => ({
      relay,
      count: null,
      status: "loading" as CountStatus,
    }));
  }, [relays]);

  useEffect(() => {
    if (relays.length === 0) {
      setLoading(false);
      setResults([]);
      return;
    }

    console.log("COUNT: Starting query", { id, relays, filter });

    setLoading(true);
    setError(null);
    setResults(initialResults);

    // Use pool.count() from applesauce-relay
    // Returns Observable<Record<string, CountResponse>>
    // where CountResponse = { count: number, approximate?: boolean }
    const observable = pool.count(relays, stableFilter as FilterWithAnd, id);

    const subscription = observable.subscribe({
      next: (countsByRelay: Record<string, { count: number }>) => {
        // Update results as we receive COUNT responses from each relay
        setResults((prev) => {
          const updated = [...prev];

          // Process each relay's response
          for (const [relay, response] of Object.entries(countsByRelay)) {
            const index = updated.findIndex((r) => r.relay === relay);
            if (index !== -1) {
              updated[index] = {
                relay,
                count: response.count,
                approximate: (response as any).approximate, // Some relays may include this
                status: "success",
              };
            }
          }

          return updated;
        });
      },
      error: (err: Error) => {
        console.error("COUNT: Error", err);
        setError(err);
        setLoading(false);

        // Mark all still-loading relays as errored
        setResults((prev) =>
          prev.map((r) =>
            r.status === "loading"
              ? { ...r, status: "error" as CountStatus, error: err.message }
              : r,
          ),
        );
      },
      complete: () => {
        console.log("COUNT: Complete");
        setLoading(false);

        // Mark any still-loading relays as errored (they didn't respond)
        setResults((prev) =>
          prev.map((r) =>
            r.status === "loading"
              ? {
                  ...r,
                  status: "error" as CountStatus,
                  error: "No response",
                }
              : r,
          ),
        );
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [id, stableFilter, stableRelays, relays.length, initialResults]);

  return {
    results,
    loading,
    error,
  };
}
