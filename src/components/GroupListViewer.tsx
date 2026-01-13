import { useState, useMemo, memo, useCallback, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { Loader2, PanelLeft } from "lucide-react";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import accountManager from "@/services/accounts";
import { ChatViewer } from "./ChatViewer";
import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";
import type { ProtocolIdentifier, GroupListIdentifier } from "@/types/chat";
import { cn } from "@/lib/utils";
import Timestamp from "./Timestamp";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

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
        "flex flex-col gap-0 px-2 py-0.5 cursor-crosshair hover:bg-muted/50 transition-colors border-b",
        isSelected && "bg-muted/70",
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
        <div className="text-xs text-muted-foreground truncate line-clamp-1">
          <UserName
            pubkey={lastMessageAuthor}
            className="text-xs font-medium"
          />
          :{" "}
          <span className="inline truncate">
            <RichText
              event={group.lastMessage}
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
    headerPrefix,
  }: {
    groupId: string;
    relayUrl: string;
    headerPrefix?: React.ReactNode;
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
        headerPrefix={headerPrefix}
      />
    );
  },
  // Custom comparison: only re-render if group actually changed
  // Note: headerPrefix is intentionally excluded - it's expected to be stable or change with isMobile
  (prev, next) =>
    prev.groupId === next.groupId && prev.relayUrl === next.relayUrl,
);

interface GroupListViewerProps {
  identifier?: GroupListIdentifier;
}

/**
 * GroupListViewer - Multi-room chat interface
 *
 * Left panel: List of groups from kind 10009, sorted by recency
 * Right panel: Chat view for selected group
 *
 * @param identifier - Optional group list identifier. If provided, loads that specific
 *                     kind 10009 event. If not provided, loads active user's list.
 */
export function GroupListViewer({ identifier }: GroupListViewerProps) {
  const activeAccount = use$(accountManager.active$);
  const activePubkey = activeAccount?.pubkey;

  // Determine which pubkey/identifier to load:
  // - If identifier prop is provided, use that (allows viewing other users' lists)
  // - Otherwise, use active user's pubkey (default behavior)
  const targetPubkey = identifier?.value.pubkey || activePubkey;
  const targetIdentifier = identifier?.value.identifier || ""; // Empty string is default d-tag for kind 10009
  const targetRelays = identifier?.relays;

  // Mobile detection
  const isMobile = useIsMobile();

  // State for selected group
  const [selectedGroup, setSelectedGroup] = useState<{
    groupId: string;
    relayUrl: string;
  } | null>(null);

  // State for mobile sidebar sheet
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // State for sidebar width (desktop only)
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

  // Handle group selection - close sidebar on mobile
  const handleGroupSelect = useCallback(
    (group: { groupId: string; relayUrl: string }) => {
      setSelectedGroup(group);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile],
  );

  // Handle resize with proper cleanup
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

      // Cleanup listeners on component unmount (stored in ref)
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    },
    [sidebarWidth],
  );

  // Cleanup resize event listeners on unmount
  useEffect(() => {
    return () => {
      setIsResizing(false);
    };
  }, []);

  // Load kind 10009 (group list) event
  // If identifier is provided with relays, subscribe to those relays first
  useEffect(() => {
    if (!targetPubkey || !targetRelays || targetRelays.length === 0) return;

    const subscription = pool
      .subscription(
        targetRelays,
        [{ kinds: [10009], authors: [targetPubkey], "#d": [targetIdentifier] }],
        { eventStore },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [targetPubkey, targetIdentifier, targetRelays]);

  const groupListEvent = use$(
    () =>
      targetPubkey
        ? eventStore.replaceable(10009, targetPubkey, targetIdentifier)
        : undefined,
    [targetPubkey, targetIdentifier],
  );

  // Extract groups from the event with relay URL validation
  const groups = useMemo(() => {
    if (!groupListEvent) return [];

    const extractedGroups: Array<{
      groupId: string;
      relayUrl: string;
    }> = [];

    for (const tag of groupListEvent.tags) {
      if (tag[0] === "group" && tag[1] && tag[2]) {
        // Validate relay URL before adding
        const relayUrl = tag[2];
        try {
          const url = new URL(
            relayUrl.startsWith("ws://") || relayUrl.startsWith("wss://")
              ? relayUrl
              : `wss://${relayUrl}`,
          );
          // Only accept ws:// or wss:// protocols
          if (url.protocol === "ws:" || url.protocol === "wss:") {
            extractedGroups.push({
              groupId: tag[1],
              relayUrl: url.toString(),
            });
          }
        } catch {
          // Invalid URL, skip this group
          continue;
        }
      }
    }

    return extractedGroups;
  }, [groupListEvent]);

  // Subscribe to group metadata (kind 39000) for all groups
  useEffect(() => {
    if (groups.length === 0) return;

    const groupIds = groups.map((g) => g.groupId).filter((id) => id !== "_");
    const relayUrls = Array.from(new Set(groups.map((g) => g.relayUrl)));

    if (groupIds.length === 0) return;

    const subscription = pool
      .subscription(relayUrls, [{ kinds: [39000], "#d": groupIds }], {
        eventStore,
      })
      .subscribe();

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
  // NOTE: Separate filters needed to ensure we get 1 message per group (not N total across all groups)
  useEffect(() => {
    if (groups.length === 0) return;

    const relayUrls = Array.from(new Set(groups.map((g) => g.relayUrl)));
    const groupIds = groups.map((g) => g.groupId);

    // One filter per group to ensure limit:1 applies per group, not globally
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
      .subscribe();

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

  // Only require sign-in if no identifier is provided (viewing own groups)
  if (!targetPubkey) {
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

  // Group list content - reused in both mobile sheet and desktop sidebar
  const groupListContent = (
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
            handleGroupSelect({
              groupId: group.groupId,
              relayUrl: group.relayUrl,
            })
          }
        />
      ))}
    </div>
  );

  // Sidebar toggle button for mobile - passed to ChatViewer's headerPrefix
  const sidebarToggle = isMobile ? (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 flex-shrink-0"
      onClick={() => setSidebarOpen(true)}
    >
      <PanelLeft className="size-4" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  ) : null;

  // Chat view content
  const chatContent = selectedGroup ? (
    <MemoizedChatViewer
      groupId={selectedGroup.groupId}
      relayUrl={selectedGroup.relayUrl}
      headerPrefix={sidebarToggle}
    />
  ) : (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {isMobile ? (
        <Button
          variant="outline"
          onClick={() => setSidebarOpen(true)}
          className="gap-2"
        >
          <PanelLeft className="size-4" />
          Select a group
        </Button>
      ) : (
        "Select a group to view chat"
      )}
    </div>
  );

  // Mobile layout: Sheet-based sidebar
  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        {/* Mobile sheet sidebar */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-0">
            <VisuallyHidden.Root>
              <SheetTitle>Groups</SheetTitle>
            </VisuallyHidden.Root>
            <div className="flex h-full flex-col pt-10">{groupListContent}</div>
          </SheetContent>
        </Sheet>

        {/* Chat content - takes full height, sidebar toggle is in ChatViewer header */}
        <div className="flex-1 min-h-0">{chatContent}</div>
      </div>
    );
  }

  // Desktop layout: Resizable sidebar
  return (
    <div className="flex h-full">
      {/* Left sidebar: Group list */}
      <aside
        className="flex flex-col border-r bg-background"
        style={{ width: sidebarWidth }}
      >
        {groupListContent}
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
      <div className="flex-1 min-w-0">{chatContent}</div>
    </div>
  );
}
