import { useState, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import {
  resolveGroupMetadata,
  type ResolvedGroupMetadata,
} from "@/lib/chat/group-metadata-helpers";

/**
 * Hook that fetches and resolves NIP-29 group metadata for a single group.
 *
 * Subscribes to kind 39000 on the group's relay, then resolves metadata
 * with profile fallback. Filters by seenRelays to avoid cross-relay contamination
 * when multiple relays host groups with the same ID.
 */
export function useGroupMetadata(
  groupId: string,
  relayUrl: string,
): ResolvedGroupMetadata | undefined {
  const isUnmanaged = groupId === "_";

  // Subscribe to kind 39000 metadata on the group's relay
  useEffect(() => {
    if (isUnmanaged) return;

    const sub = pool
      .subscription([relayUrl], [{ kinds: [39000], "#d": [groupId] }], {
        eventStore,
      })
      .subscribe();

    return () => sub.unsubscribe();
  }, [groupId, relayUrl, isUnmanaged]);

  // Observe the metadata event from the store via timeline query.
  // kind 39000 author is the relay's pubkey (unknown in advance), so we
  // query by d-tag and filter by seenRelays to get the correct relay's metadata.
  const normalizedRelay = relayUrl.replace(/\/$/, "");
  const metadataEvent = use$(
    () =>
      !isUnmanaged
        ? eventStore.timeline([{ kinds: [39000], "#d": [groupId] }]).pipe(
            map((events) => {
              // Prefer the event actually seen on this relay
              const fromRelay = events.find((evt) => {
                const seen = getSeenRelays(evt);
                if (!seen || seen.size === 0) return false;
                return Array.from(seen).some(
                  (r) => r.replace(/\/$/, "") === normalizedRelay,
                );
              });
              return fromRelay ?? events[0];
            }),
          )
        : undefined,
    [groupId, isUnmanaged, normalizedRelay],
  );

  // Resolve metadata with profile fallback
  const [resolved, setResolved] = useState<ResolvedGroupMetadata | undefined>();

  useEffect(() => {
    if (isUnmanaged) return;

    let cancelled = false;

    resolveGroupMetadata(groupId, relayUrl, metadataEvent).then((result) => {
      if (!cancelled) setResolved(result);
    });

    return () => {
      cancelled = true;
    };
  }, [groupId, relayUrl, metadataEvent, isUnmanaged]);

  return resolved;
}
