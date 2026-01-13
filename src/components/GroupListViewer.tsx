import { useState, useMemo, memo, useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { Loader2 } from "lucide-react";
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
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";

interface GroupInfo {
  groupId: string;
  relayUrl: string;
  metadata?: NostrEvent;
  lastMessage?: NostrEvent;
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
const GroupListItem = memo(function GroupListItem({
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

  // Get last message author and content
  const lastMessageAuthor = group.lastMessage?.pubkey;
  const lastMessageContent = group.lastMessage?.content;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-3 py-2 cursor-crosshair hover:bg-muted/50 transition-colors border-b",
        isSelected && "bg-muted",
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{groupName}</span>
        {group.lastMessage && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            <Timestamp timestamp={group.lastMessage.created_at} />
          </span>
        )}
      </div>
      {/* Last message preview - hide images and event embeds */}
      {lastMessageAuthor && lastMessageContent && (
        <div className="text-xs text-muted-foreground truncate">
          <UserName
            pubkey={lastMessageAuthor}
            className="text-xs font-medium"
          />
          :{" "}
          <span className="inline truncate">
            <RichText
              content={lastMessageContent}
              className="inline"
              options={{
                showImages: false,
                showEventEmbeds: false,
              }}
            />
          </span>
        </div>
      )}
    </div>
  );
});

/**
 * MemoizedChatViewer - Memoized chat viewer to prevent unnecessary re-renders
 */
const MemoizedChatViewer = memo(
  function MemoizedChatViewer({
    groupId,
    relayUrl,
  }: {
    groupId: string;
    relayUrl: string;
  }) {
    return (
      <ChatViewer
        protocol="nip-29"
        identifier={
          {
            type: "group",
            value: groupId,
            relays: [relayUrl],
          } as ProtocolIdentifier
        }
      />
    );
  },
  // Custom comparison: only re-render if group actually changed
  (prev, next) =>
    prev.groupId === next.groupId && prev.relayUrl === next.relayUrl,
);

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

  // State for sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

  // Handle resize
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const newWidth = startWidth + deltaX;
        // Clamp between 200px and 500px
        setSidebarWidth(Math.max(200, Math.min(500, newWidth)));
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [sidebarWidth],
  );

  // Load user's kind 10009 (group list) event
  const groupListEvent = use$(
    () =>
      activePubkey
        ? eventStore.replaceable(10009, activePubkey).pipe(
            map((event) => {
              if (event) {
                console.log(
                  `[GroupListViewer] Loaded group list event: ${event.id.slice(0, 8)}...`,
                );
              }
              return event;
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
          // Create a map of groupId -> latest message
          const messageMap = new Map<string, NostrEvent>();
          for (const evt of events) {
            const hTag = evt.tags.find((t) => t[0] === "h");
            if (hTag && hTag[1]) {
              const existing = messageMap.get(hTag[1]);
              if (!existing || evt.created_at > existing.created_at) {
                messageMap.set(hTag[1], evt);
              }
            }
          }

          // Merge with groups
          const groupsWithInfo: GroupInfo[] = groups.map((g) => ({
            groupId: g.groupId,
            relayUrl: g.relayUrl,
            metadata: groupMetadataMap?.get(g.groupId),
            lastMessage: messageMap.get(g.groupId),
          }));

          // Sort by recency (most recent first)
          groupsWithInfo.sort((a, b) => {
            const aTime = a.lastMessage?.created_at || 0;
            const bTime = b.lastMessage?.created_at || 0;
            return bTime - aTime;
          });

          return groupsWithInfo;
        }),
      );
  }, [groups, groupMetadataMap]);

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
      {/* Left sidebar: Group list */}
      <aside
        className="flex flex-col border-r bg-background"
        style={{ width: sidebarWidth }}
      >
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
      </aside>

      {/* Resize handle */}
      <div
        className={cn(
          "w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors",
          isResizing && "bg-primary",
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Right panel: Chat view */}
      <div className="flex-1 min-w-0">
        {selectedGroup ? (
          <MemoizedChatViewer
            groupId={selectedGroup.groupId}
            relayUrl={selectedGroup.relayUrl}
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
