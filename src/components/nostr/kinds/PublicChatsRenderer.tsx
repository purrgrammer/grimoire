import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { useEffect } from "react";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { GroupLink } from "../GroupLink";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import type { NostrEvent } from "@/types/nostr";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";

/**
 * Extract group references from a kind 10009 event
 * Groups are stored in "group" tags: ["group", "<group-id>", "<relay-url>", ...]
 */
function extractGroups(event: { tags: string[][] }): Array<{
  groupId: string;
  relayUrl: string;
}> {
  const groups: Array<{ groupId: string; relayUrl: string }> = [];

  for (const tag of event.tags) {
    if (tag[0] === "group" && tag[1] && tag[2]) {
      // Only include groups with valid relay URLs
      const relayUrl = tag[2];
      if (!isSafeRelayURL(relayUrl)) {
        console.warn(
          `[PublicChatsRenderer] Skipping group with invalid relay URL: ${relayUrl}`,
        );
        continue;
      }
      groups.push({
        groupId: tag[1],
        relayUrl,
      });
    }
  }

  return groups;
}

/**
 * Public Chats Renderer (Kind 10009)
 * NIP-51 list of NIP-29 groups
 * Displays each group as a clickable link with icon and name
 * Batch-loads metadata for all groups to show their names
 */
export function PublicChatsRenderer({ event }: BaseEventProps) {
  const groups = extractGroups(event);

  // Batch-load metadata for all groups at once
  // Filter out "_" which is the unmanaged relay group (doesn't have metadata)
  const groupIds = groups.map((g) => g.groupId).filter((id) => id !== "_");

  // Subscribe to relays to fetch group metadata
  // Extract unique relay URLs from groups
  const relayUrls = Array.from(new Set(groups.map((g) => g.relayUrl)));

  useEffect(() => {
    if (groupIds.length === 0) return;

    console.log(
      `[PublicChatsRenderer] Fetching metadata for ${groupIds.length} groups from ${relayUrls.length} relays`,
    );

    // Subscribe to fetch metadata events (kind 39000) from the group relays
    const subscription = pool
      .subscription(
        relayUrls,
        [{ kinds: [39000], "#d": groupIds }],
        { eventStore }, // Automatically add to store
      )
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[PublicChatsRenderer] EOSE received for metadata");
          } else {
            console.log(
              `[PublicChatsRenderer] Received metadata: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [groupIds.join(","), relayUrls.join(",")]);

  const groupMetadataMap = use$(
    () =>
      groupIds.length > 0
        ? eventStore.timeline([{ kinds: [39000], "#d": groupIds }]).pipe(
            map((events) => {
              const metadataMap = new Map<string, NostrEvent>();
              for (const evt of events) {
                // Extract group ID from #d tag
                const dTag = evt.tags.find((t) => t[0] === "d");
                if (dTag && dTag[1]) {
                  metadataMap.set(dTag[1], evt);
                }
              }
              return metadataMap;
            }),
          )
        : undefined,
    [groupIds.join(",")],
  );

  if (groups.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No public chats configured
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-0.5">
        {groups.map((group) => (
          <GroupLink
            key={`${group.relayUrl}'${group.groupId}`}
            groupId={group.groupId}
            relayUrl={group.relayUrl}
            metadata={groupMetadataMap?.get(group.groupId)}
          />
        ))}
      </div>
    </BaseEventContainer>
  );
}
