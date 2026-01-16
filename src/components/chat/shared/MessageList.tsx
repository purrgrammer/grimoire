import { useRef, useCallback, ReactNode } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DayMarker } from "./DayMarker";
import type { MessageListItem } from "./types";

interface MessageListProps<T extends { id: string; timestamp: number }> {
  /** Items to render (messages + day markers) */
  items: MessageListItem<T>[];
  /** Render function for messages */
  renderMessage: (
    message: T,
    onScrollToMessage?: (messageId: string) => void,
  ) => ReactNode;
  /** Whether there are more messages to load */
  hasMore?: boolean;
  /** Whether loading is in progress */
  isLoading?: boolean;
  /** Called when user requests to load older messages */
  onLoadMore?: () => void;
  /** Empty state content */
  emptyState?: ReactNode;
}

/**
 * MessageList - Generic virtualized message list with day markers
 * Handles infinite scrolling, day separators, and message rendering
 */
export function MessageList<T extends { id: string; timestamp: number }>({
  items,
  renderMessage,
  hasMore = false,
  isLoading = false,
  onLoadMore,
  emptyState,
}: MessageListProps<T>) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Handle scroll to message
  const handleScrollToMessage = useCallback(
    (messageId: string) => {
      if (!items) return;
      // Find index in the rendered array (which includes day markers)
      const index = items.findIndex(
        (item) => item.type === "message" && item.data.id === messageId,
      );
      if (index !== -1 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index,
          align: "center",
          behavior: "smooth",
        });
      }
    },
    [items],
  );

  // Show empty state if no items
  if (!items || items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {emptyState || "No messages yet. Start the conversation!"}
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={items}
      initialTopMostItemIndex={items.length - 1}
      followOutput="smooth"
      alignToBottom
      components={{
        Header: () =>
          hasMore && onLoadMore ? (
            <div className="flex justify-center py-2">
              <Button
                onClick={onLoadMore}
                disabled={isLoading}
                variant="ghost"
                size="sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <span className="text-xs">Loading...</span>
                  </>
                ) : (
                  "Load older messages"
                )}
              </Button>
            </div>
          ) : null,
        Footer: () => <div className="h-1" />,
      }}
      itemContent={(_index, item) => {
        if (item.type === "day-marker") {
          return <DayMarker label={item.data} timestamp={item.timestamp} />;
        }
        return renderMessage(item.data, handleScrollToMessage);
      }}
      style={{ height: "100%" }}
    />
  );
}

/**
 * Hook to expose virtuoso ref to parent components
 * Useful for programmatic scrolling
 */
export function useMessageListRef() {
  return useRef<VirtuosoHandle>(null);
}

export type { VirtuosoHandle as MessageListHandle };
