import { useState, useMemo, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { isNostrEvent } from "@/lib/type-guards";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { useStableArray } from "@/hooks/useStable";
import type { NostrEvent } from "@/types/nostr";

export interface GroupEntry {
  groupId: string;
  relayUrl: string;
  lastMessage?: NostrEvent;
}

/**
 * Hook that loads a kind 10009 group list, extracts groups,
 * and subscribes per-relay for last messages (kind 9).
 *
 * Keys last-message map by `relayUrl'groupId` to prevent
 * cross-relay contamination when groups share the same ID.
 */
export function useNip29GroupList(
  pubkey: string | undefined,
  identifier: string,
  relays?: string[],
): {
  groupListEvent: NostrEvent | undefined;
  groups: GroupEntry[];
  loading: boolean;
} {
  const stableRelays = useStableArray(relays || []);

  // Subscribe to kind 10009 from hint relays if provided
  useEffect(() => {
    if (!pubkey || stableRelays.length === 0) return;

    const sub = pool
      .subscription(
        stableRelays,
        [{ kinds: [10009], authors: [pubkey], "#d": [identifier] }],
        { eventStore },
      )
      .subscribe();

    return () => sub.unsubscribe();
  }, [pubkey, identifier, stableRelays]);

  // Observe the replaceable event from the store
  const groupListEvent = use$(
    () =>
      pubkey ? eventStore.replaceable(10009, pubkey, identifier) : undefined,
    [pubkey, identifier],
  );

  // Extract group entries from tags
  const extractedGroups = useMemo(() => {
    if (!groupListEvent) return [];

    const result: Array<{ groupId: string; relayUrl: string }> = [];

    for (const tag of groupListEvent.tags) {
      if (tag[0] === "group" && tag[1] && tag[2]) {
        const raw = tag[2];
        try {
          const url = new URL(
            raw.startsWith("ws://") || raw.startsWith("wss://")
              ? raw
              : `wss://${raw}`,
          );
          if (url.protocol === "ws:" || url.protocol === "wss:") {
            result.push({ groupId: tag[1], relayUrl: url.toString() });
          }
        } catch {
          continue;
        }
      }
    }

    return result;
  }, [groupListEvent]);

  // Track last message per relay'groupId
  const [lastMessageMap, setLastMessageMap] = useState<Map<string, NostrEvent>>(
    new Map(),
  );

  // Per-relay subscriptions for last messages (kind 9)
  // Each relay only gets filters for its own groups, and we attribute
  // incoming events to the relay we received them from.
  useEffect(() => {
    if (extractedGroups.length === 0) return;

    // Group by relay URL
    const byRelay = new Map<string, string[]>();
    for (const g of extractedGroups) {
      const list = byRelay.get(g.relayUrl) || [];
      list.push(g.groupId);
      byRelay.set(g.relayUrl, list);
    }

    const subs: Array<{ unsubscribe: () => void }> = [];

    for (const [relayUrl, groupIds] of byRelay) {
      // One filter per group so limit:1 applies per group, not globally
      const filters = groupIds.map((gid) => ({
        kinds: [9],
        "#h": [gid],
        limit: 1,
      }));

      const sub = pool
        .subscription([relayUrl], filters, { eventStore })
        .subscribe((response) => {
          if (!isNostrEvent(response)) return;

          const hTag = response.tags.find((t) => t[0] === "h");
          if (!hTag?.[1]) return;
          const groupId = hTag[1];

          // Only track if this groupId belongs to this relay
          if (!groupIds.includes(groupId)) return;

          const key = `${relayUrl}'${groupId}`;

          setLastMessageMap((prev) => {
            const existing = prev.get(key);
            if (existing && existing.created_at >= response.created_at) {
              return prev;
            }
            const next = new Map(prev);
            next.set(key, response);
            return next;
          });
        });

      subs.push(sub);
    }

    return () => subs.forEach((s) => s.unsubscribe());
  }, [extractedGroups]);

  // Merge groups with last messages and sort by recency
  const groups: GroupEntry[] = useMemo(() => {
    const result = extractedGroups.map((g) => ({
      groupId: g.groupId,
      relayUrl: g.relayUrl,
      lastMessage: lastMessageMap.get(`${g.relayUrl}'${g.groupId}`),
    }));

    result.sort((a, b) => {
      const aTime = a.lastMessage?.created_at || 0;
      const bTime = b.lastMessage?.created_at || 0;
      return bTime - aTime;
    });

    return result;
  }, [extractedGroups, lastMessageMap]);

  return {
    groupListEvent,
    groups,
    loading: !groupListEvent && !!pubkey,
  };
}
