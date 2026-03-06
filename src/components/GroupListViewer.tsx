import { useState, memo, useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { Loader2, PanelLeft } from "lucide-react";
import accountManager from "@/services/accounts";
import { ChatViewer } from "./ChatViewer";
import type { ProtocolIdentifier, GroupListIdentifier } from "@/types/chat";
import { cn } from "@/lib/utils";
import Timestamp from "./Timestamp";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useNip29GroupList, type GroupEntry } from "@/hooks/useNip29GroupList";
import { useGroupMetadata } from "@/hooks/useGroupMetadata";

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
  group: GroupEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isUnmanagedGroup = group.groupId === "_";
  const resolvedMetadata = useGroupMetadata(group.groupId, group.relayUrl);

  const groupName = isUnmanagedGroup
    ? formatRelayForDisplay(group.relayUrl)
    : resolvedMetadata?.name || group.groupId;

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
        <div className="text-xs text-muted-foreground truncate line-clamp-1 pointer-events-none">
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

  // Determine which pubkey/identifier to load
  const targetPubkey = identifier?.value.pubkey || activePubkey;
  const targetIdentifier = identifier?.value.identifier || "";
  const targetRelays = identifier?.relays;

  const isMobile = useIsMobile();

  // Load groups and last messages (per-relay, composite-keyed)
  const { groupListEvent, groups } = useNip29GroupList(
    targetPubkey,
    targetIdentifier,
    targetRelays,
  );

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

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No groups configured. Add groups to your kind 10009 list.
      </div>
    );
  }

  // Group list content - reused in both mobile sheet and desktop sidebar
  const groupListContent = (
    <div className="flex-1 overflow-y-auto">
      {groups.map((group) => (
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
      className="h-7 w-7 shrink-0"
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
