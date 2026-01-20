import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { useEffect } from "react";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { GroupLink } from "../GroupLink";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { isValidPubkey } from "@/lib/chat-parser";
import type { NostrEvent } from "@/types/nostr";

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
      groups.push({
        groupId: tag[1],
        relayUrl: tag[2],
      });
    }
  }

  return groups;
}

/**
 * Public Chats Renderer (Kind 10009)
 * NIP-51 list of NIP-29 groups and Communikeys
 * Displays each group as a clickable link with icon and name
 * Batch-loads metadata for all groups to show their names
 * For Communikeys (pubkey-based groups), fetches kind 0 (profile) metadata
 * For regular NIP-29 groups, fetches kind 39000 (group metadata)
 */
export function PublicChatsRenderer({ event }: BaseEventProps) {
  const groups = extractGroups(event);

  // Split groups into Communikeys (valid pubkeys) and regular NIP-29 groups
  // Filter out "_" which is the unmanaged relay group (doesn't have metadata)
  const communikeyGroups = groups.filter(
    (g) => g.groupId !== "_" && isValidPubkey(g.groupId),
  );
  const nip29Groups = groups.filter(
    (g) => g.groupId !== "_" && !isValidPubkey(g.groupId),
  );

  const communikeyPubkeys = communikeyGroups.map((g) => g.groupId);
  const nip29GroupIds = nip29Groups.map((g) => g.groupId);

  // Extract unique relay URLs from groups
  const relayUrls = Array.from(new Set(groups.map((g) => g.relayUrl)));

  useEffect(() => {
    if (communikeyPubkeys.length === 0 && nip29GroupIds.length === 0) return;

    console.log(
      `[PublicChatsRenderer] Fetching metadata for ${communikeyPubkeys.length} Communikeys and ${nip29GroupIds.length} NIP-29 groups from ${relayUrls.length} relays`,
    );

    // Build filters for both types
    const filters = [];

    // Fetch kind 0 (profiles) for Communikeys
    if (communikeyPubkeys.length > 0) {
      filters.push({ kinds: [0], authors: communikeyPubkeys });
    }

    // Fetch kind 39000 (group metadata) for regular NIP-29 groups
    if (nip29GroupIds.length > 0) {
      filters.push({ kinds: [39000], "#d": nip29GroupIds });
    }

    // Subscribe to fetch metadata from the group relays
    const subscription = pool
      .subscription(relayUrls, filters, { eventStore })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[PublicChatsRenderer] EOSE received for metadata");
          } else {
            console.log(
              `[PublicChatsRenderer] Received metadata k${response.kind}: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [
    communikeyPubkeys.join(","),
    nip29GroupIds.join(","),
    relayUrls.join(","),
  ]);

  // Build combined metadata map from both kind 0 (Communikeys) and kind 39000 (NIP-29)
  const groupMetadataMap = use$(
    () =>
      communikeyPubkeys.length > 0 || nip29GroupIds.length > 0
        ? eventStore
            .timeline([
              ...(communikeyPubkeys.length > 0
                ? [{ kinds: [0], authors: communikeyPubkeys }]
                : []),
              ...(nip29GroupIds.length > 0
                ? [{ kinds: [39000], "#d": nip29GroupIds }]
                : []),
            ])
            .pipe(
              map((events) => {
                const metadataMap = new Map<string, NostrEvent>();

                for (const evt of events) {
                  if (evt.kind === 0) {
                    // Communikey profile (kind 0) - map by pubkey
                    metadataMap.set(evt.pubkey, evt);
                  } else if (evt.kind === 39000) {
                    // NIP-29 group metadata - map by d-tag (group ID)
                    const dTag = evt.tags.find((t) => t[0] === "d");
                    if (dTag && dTag[1]) {
                      metadataMap.set(dTag[1], evt);
                    }
                  }
                }

                return metadataMap;
              }),
            )
        : undefined,
    [communikeyPubkeys.join(","), nip29GroupIds.join(",")],
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
