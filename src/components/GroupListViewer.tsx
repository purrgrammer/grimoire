import { useState, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { Loader2, MessageSquare } from "lucide-react";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import accountManager from "@/services/accounts";
import { ChatViewer } from "./ChatViewer";
import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";
import type { ProtocolIdentifier } from "@/types/chat";
import { cn } from "@/lib/utils";
import Timestamp from "./Timestamp";
import { useEffect } from "react";

interface GroupInfo {
  groupId: string;
  relayUrl: string;
  metadata?: NostrEvent;
  lastMessageTimestamp?: number;
}

/**
 * Format relay URL for display
 */
function formatRelayForDisplay(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

/**
 * GroupListItem - Single group in the list
 */
function GroupListItem({
  group,
  isSelected,
  onClick,
}: {
  group: GroupInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  // Extract group name from metadata
  const isUnmanagedGroup = group.groupId === "_";
  let groupName: string;
  if (isUnmanagedGroup) {
    groupName = formatRelayForDisplay(group.relayUrl);
  } else if (group.metadata && group.metadata.kind === 39000) {
    groupName = getTagValue(group.metadata, "name") || group.groupId;
  } else {
    groupName = group.groupId;
  }

  // Extract group icon
  const groupIcon =
    !isUnmanagedGroup && group.metadata && group.metadata.kind === 39000
      ? getTagValue(group.metadata, "picture")
      : undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 cursor-crosshair hover:bg-muted/50 transition-colors border-b",
        isSelected && "bg-muted",
      )}
      onClick={onClick}
    >
      <div className="flex-shrink-0">
        {groupIcon ? (
          <img
            src={groupIcon}
            alt=""
            className="size-8 rounded object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="size-8 rounded bg-muted flex items-center justify-center">
            <MessageSquare className="size-4 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{groupName}</div>
        {group.lastMessageTimestamp && (
          <div className="text-xs text-muted-foreground">
            <Timestamp timestamp={group.lastMessageTimestamp} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * GroupListViewer - Multi-room chat interface
 *
 * Left panel: List of groups from user's kind 10009, sorted by recency
 * Right panel: Chat view for selected group
 */
export function GroupListViewer() {
  const activeAccount = use$(accountManager.active$);
  const activePubkey = activeAccount?.pubkey;

  // State for selected group
  const [selectedGroup, setSelectedGroup] = useState<{
    groupId: string;
    relayUrl: string;
  } | null>(null);

  // Load user's kind 10009 (group list) event
  const groupListEvent = use$(
    () =>
      activePubkey
        ? eventStore.replaceable(10009, activePubkey).pipe(
            map((events) => {
              console.log(
                `[GroupListViewer] Loaded ${events.length} group list events`,
              );
              return events[0]; // replaceable() returns array, take most recent
            }),
          )
        : undefined,
    [activePubkey],
  );

  // Extract groups from the event
  const groups = useMemo(() => {
    if (!groupListEvent) return [];

    const extractedGroups: Array<{
      groupId: string;
      relayUrl: string;
    }> = [];

    for (const tag of groupListEvent.tags) {
      if (tag[0] === "group" && tag[1] && tag[2]) {
        extractedGroups.push({
          groupId: tag[1],
          relayUrl: tag[2],
        });
      }
    }

    console.log(`[GroupListViewer] Found ${extractedGroups.length} groups`);
    return extractedGroups;
  }, [groupListEvent]);

  // Subscribe to group metadata (kind 39000) for all groups
  useEffect(() => {
    if (groups.length === 0) return;

    const groupIds = groups.map((g) => g.groupId).filter((id) => id !== "_");
    const relayUrls = Array.from(new Set(groups.map((g) => g.relayUrl)));

    if (groupIds.length === 0) return;

    console.log(
      `[GroupListViewer] Subscribing to metadata for ${groupIds.length} groups from ${relayUrls.length} relays`,
    );

    const subscription = pool
      .subscription(relayUrls, [{ kinds: [39000], "#d": groupIds }], {
        eventStore,
      })
      .subscribe({
        next: (response) => {
          if (typeof response === "string") {
            console.log("[GroupListViewer] EOSE received for metadata");
          } else {
            console.log(
              `[GroupListViewer] Received metadata: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [groups]);

  // Load metadata for all groups
  const groupMetadataMap = use$(() => {
    const groupIds = groups.map((g) => g.groupId).filter((id) => id !== "_");
    if (groupIds.length === 0) return undefined;

    return eventStore.timeline([{ kinds: [39000], "#d": groupIds }]).pipe(
      map((events) => {
        const metadataMap = new Map<string, NostrEvent>();
        for (const evt of events) {
          const dTag = evt.tags.find((t) => t[0] === "d");
          if (dTag && dTag[1]) {
            metadataMap.set(dTag[1], evt);
          }
        }
        return metadataMap;
      }),
    );
  }, [groups]);

  // Subscribe to latest messages (kind 9) for all groups to get recency
  useEffect(() => {
    if (groups.length === 0) return;

    const relayUrls = Array.from(new Set(groups.map((g) => g.relayUrl)));
    const groupIds = groups.map((g) => g.groupId);

    console.log(
      `[GroupListViewer] Subscribing to latest messages for ${groupIds.length} groups`,
    );

    // Subscribe to latest message from each group (limit 1 per group)
    const subscription = pool
      .subscription(
        relayUrls,
        groupIds.map((groupId) => ({
          kinds: [9],
          "#h": [groupId],
          limit: 1,
        })),
        { eventStore },
      )
      .subscribe({
        next: (response) => {
          if (typeof response !== "string") {
            console.log(
              `[GroupListViewer] Received latest message: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [groups]);

  // Load latest messages and merge with group data
  const groupsWithRecency = use$(() => {
    if (groups.length === 0) return undefined;

    const groupIds = groups.map((g) => g.groupId);

    return eventStore
      .timeline(
        groupIds.map((groupId) => ({
          kinds: [9],
          "#h": [groupId],
          limit: 1,
        })),
      )
      .pipe(
        map((events) => {
          // Create a map of groupId -> latest message timestamp
          const recencyMap = new Map<string, number>();
          for (const evt of events) {
            const hTag = evt.tags.find((t) => t[0] === "h");
            if (hTag && hTag[1]) {
              const existing = recencyMap.get(hTag[1]);
              if (!existing || evt.created_at > existing) {
                recencyMap.set(hTag[1], evt.created_at);
              }
            }
          }

          // Merge with groups
          const groupsWithInfo: GroupInfo[] = groups.map((g) => ({
            groupId: g.groupId,
            relayUrl: g.relayUrl,
            metadata: groupMetadataMap?.get(g.groupId),
            lastMessageTimestamp: recencyMap.get(g.groupId),
          }));

          // Sort by recency (most recent first)
          groupsWithInfo.sort((a, b) => {
            const aTime = a.lastMessageTimestamp || 0;
            const bTime = b.lastMessageTimestamp || 0;
            return bTime - aTime;
          });

          return groupsWithInfo;
        }),
      );
  }, [groups, groupMetadataMap]);

  // Auto-select first group if none selected
  useEffect(() => {
    if (!selectedGroup && groupsWithRecency && groupsWithRecency.length > 0) {
      const first = groupsWithRecency[0];
      setSelectedGroup({
        groupId: first.groupId,
        relayUrl: first.relayUrl,
      });
    }
  }, [selectedGroup, groupsWithRecency]);

  if (!activePubkey) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Sign in to view your groups
      </div>
    );
  }

  if (!groupListEvent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span>Loading groups...</span>
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No groups configured. Add groups to your kind 10009 list.
      </div>
    );
  }

  if (!groupsWithRecency) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span>Loading group details...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel: Group list */}
      <div className="w-64 border-r flex flex-col">
        <div className="border-b px-3 py-2">
          <div className="text-sm font-semibold">Groups</div>
          <div className="text-xs text-muted-foreground">
            {groupsWithRecency.length}{" "}
            {groupsWithRecency.length === 1 ? "group" : "groups"}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {groupsWithRecency.map((group) => (
            <GroupListItem
              key={`${group.relayUrl}'${group.groupId}`}
              group={group}
              isSelected={
                selectedGroup?.groupId === group.groupId &&
                selectedGroup?.relayUrl === group.relayUrl
              }
              onClick={() =>
                setSelectedGroup({
                  groupId: group.groupId,
                  relayUrl: group.relayUrl,
                })
              }
            />
          ))}
        </div>
      </div>

      {/* Right panel: Chat view */}
      <div className="flex-1">
        {selectedGroup ? (
          <ChatViewer
            protocol="nip-29"
            identifier={
              {
                type: "group",
                value: selectedGroup.groupId,
                relays: [selectedGroup.relayUrl],
              } as ProtocolIdentifier
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a group to view chat
          </div>
        )}
      </div>
    </div>
  );
}
