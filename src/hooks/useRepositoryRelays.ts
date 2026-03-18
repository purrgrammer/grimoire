import { useMemo } from "react";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getRepositoryRelays } from "@/lib/nip34-helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useUserRelays } from "@/hooks/useUserRelays";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import type { NostrEvent } from "@/types/nostr";

/**
 * Resolves the relay list for a NIP-34 git repository address.
 *
 * Fallback chain:
 * 1. Relays from the repository event's `relays` tag (kind 30617)
 * 2. Repository owner's outbox relays (kind 10002)
 * 3. Well-known aggregator relays
 *
 * Also returns the repository event, needed by callers for getValidStatusAuthors.
 */
export function useRepositoryRelays(repoAddress: string | undefined): {
  relays: string[];
  repositoryEvent: NostrEvent | undefined;
} {
  const repoPointer = useMemo(
    () =>
      repoAddress
        ? (parseReplaceableAddress(repoAddress) ?? undefined)
        : undefined,
    [repoAddress],
  );

  const repositoryEvent = useNostrEvent(repoPointer);
  const { outboxRelays } = useUserRelays(repoPointer?.pubkey);

  const relays = useMemo(() => {
    if (repositoryEvent) {
      const repoRelays = getRepositoryRelays(repositoryEvent);
      if (repoRelays.length > 0) return repoRelays;
    }
    if (outboxRelays && outboxRelays.length > 0) return outboxRelays;
    return AGGREGATOR_RELAYS;
  }, [repositoryEvent, outboxRelays]);

  return { relays, repositoryEvent };
}
