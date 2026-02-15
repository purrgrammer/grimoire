import { useMemo } from "react";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getOutboxes } from "applesauce-core/helpers";
import { useNostrEvent } from "./useNostrEvent";
import { getRepositoryRelays } from "@/lib/nip34-helpers";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * Hook to resolve relay URLs for a NIP-34 repository address.
 *
 * Implements the standard relay fallback chain:
 * 1. Repository-configured relays (from the repo event's `relays` tag)
 * 2. Repository author's outbox (write) relays (from kind 10002)
 * 3. AGGREGATOR_RELAYS as final fallback
 *
 * Also returns the fetched repository event, useful for getting
 * maintainers list and other repo metadata.
 *
 * @param repoAddress - Repository address in "kind:pubkey:identifier" format
 */
export function useRepositoryRelays(repoAddress: string | undefined) {
  const parsedRepo = useMemo(
    () => (repoAddress ? parseReplaceableAddress(repoAddress) : null),
    [repoAddress],
  );

  const repoPointer = useMemo(() => {
    if (!parsedRepo) return undefined;
    return {
      kind: parsedRepo.kind,
      pubkey: parsedRepo.pubkey,
      identifier: parsedRepo.identifier,
    };
  }, [parsedRepo]);

  const repositoryEvent = useNostrEvent(repoPointer);

  const repoAuthorRelayListPointer = useMemo(() => {
    if (!parsedRepo?.pubkey) return undefined;
    return { kind: 10002, pubkey: parsedRepo.pubkey, identifier: "" };
  }, [parsedRepo?.pubkey]);

  const repoAuthorRelayList = useNostrEvent(repoAuthorRelayListPointer);

  const relays = useMemo(() => {
    if (repositoryEvent) {
      const repoRelays = getRepositoryRelays(repositoryEvent);
      if (repoRelays.length > 0) return repoRelays;
    }
    if (repoAuthorRelayList) {
      const authorOutbox = getOutboxes(repoAuthorRelayList);
      if (authorOutbox.length > 0) return authorOutbox;
    }
    return AGGREGATOR_RELAYS;
  }, [repositoryEvent, repoAuthorRelayList]);

  return { relays, repositoryEvent };
}
