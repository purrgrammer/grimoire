import { useEffect } from "react";
import { useAccount } from "./useAccount";
import { useUserRelays } from "./useUserRelays";
import { useStableArray } from "./useStable";
import { ALL_FAVORITE_LIST_KINDS } from "@/config/favorite-lists";
import { addressLoader } from "@/services/loaders";

/**
 * Fetch all configured favorite list kinds from relays at app boot,
 * so they're available in EventStore before any UI needs them.
 */
export function useFavoriteListsSync() {
  const { pubkey } = useAccount();
  const { outboxRelays } = useUserRelays(pubkey);
  const stableRelays = useStableArray(outboxRelays ?? []);

  useEffect(() => {
    if (!pubkey) return;

    const subs = ALL_FAVORITE_LIST_KINDS.map((listKind) =>
      addressLoader({
        kind: listKind,
        pubkey,
        identifier: "",
        relays: stableRelays,
      }).subscribe(),
    );

    return () => subs.forEach((s) => s.unsubscribe());
  }, [pubkey, stableRelays]);
}
