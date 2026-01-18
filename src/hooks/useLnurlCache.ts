import db from "@/services/db";
import { resolveLightningAddress, type LnUrlPayResponse } from "@/lib/lnurl";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

// Cache TTL: 24 hours (LNURL configs rarely change)
const CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Hook to fetch and cache LNURL address resolution data
 * Similar to useNip05 but for Lightning addresses
 *
 * Benefits:
 * - Instant zap UI on subsequent zaps (no 10s network delay)
 * - Offline capability (show limits/amounts from cache)
 * - Reduced load on LNURL servers
 * - Better UX for frequently zapped users
 */
export function useLnurlCache(address: string | undefined) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Get cached data from Dexie
  const cached = useLiveQuery(
    () => (address ? db.lnurlCache.get(address) : undefined),
    [address],
  );

  useEffect(() => {
    if (!address) return;

    // Check if cache is fresh (within TTL)
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL;
    if (isFresh) {
      setError(null);
      return;
    }

    // Fetch and cache LNURL data
    setIsLoading(true);
    setError(null);

    resolveLightningAddress(address)
      .then((data: LnUrlPayResponse) => {
        db.lnurlCache.put({
          address,
          callback: data.callback,
          minSendable: data.minSendable,
          maxSendable: data.maxSendable,
          metadata: data.metadata,
          tag: data.tag,
          allowsNostr: data.allowsNostr,
          nostrPubkey: data.nostrPubkey,
          commentAllowed: data.commentAllowed,
          fetchedAt: Date.now(),
        });
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to resolve Lightning address:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
  }, [address, cached]);

  return {
    data: cached,
    isLoading,
    error,
    isCached: !!cached,
  };
}
