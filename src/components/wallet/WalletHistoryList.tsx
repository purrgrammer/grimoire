/**
 * WalletHistoryList Component
 *
 * Virtualized list of wallet transactions/history with day markers.
 * Shared between NWC and NIP-61 wallet viewers.
 */

import { ReactNode, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { RefreshCw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export interface HistoryItem {
  /** Unique identifier */
  id: string;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Custom data for rendering */
  data: unknown;
}

interface WalletHistoryListProps<T extends HistoryItem> {
  /** History items to display */
  items: T[];
  /** Whether initial load is in progress */
  loading: boolean;
  /** Whether more items are being loaded */
  loadingMore?: boolean;
  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Whether loading failed */
  loadFailed?: boolean;
  /** Callback to load more items */
  onLoadMore?: () => void;
  /** Callback to retry loading */
  onRetry?: () => void;
  /** Render function for each item */
  renderItem: (item: T, index: number) => ReactNode;
  /** Empty state message */
  emptyMessage?: string;
}

/**
 * Format timestamp as a readable day marker
 */
function formatDayMarker(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Reset time parts for comparison
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const yesterdayOnly = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return "Today";
  } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return "Yesterday";
  } else {
    // Format as "Jan 15" (short month, no year, respects locale)
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
}

/**
 * Check if two timestamps are on different days
 */
function isDifferentDay(timestamp1: number, timestamp2: number): boolean {
  const date1 = new Date(timestamp1 * 1000);
  const date2 = new Date(timestamp2 * 1000);

  return (
    date1.getFullYear() !== date2.getFullYear() ||
    date1.getMonth() !== date2.getMonth() ||
    date1.getDate() !== date2.getDate()
  );
}

type ListItem<T> =
  | { type: "item"; data: T }
  | { type: "day-marker"; label: string; timestamp: number };

export function WalletHistoryList<T extends HistoryItem>({
  items,
  loading,
  loadingMore = false,
  hasMore = false,
  loadFailed = false,
  onLoadMore,
  onRetry,
  renderItem,
  emptyMessage = "No transactions found",
}: WalletHistoryListProps<T>) {
  // Process items to include day markers
  const itemsWithMarkers = useMemo(() => {
    if (!items || items.length === 0) return [];

    const result: ListItem<T>[] = [];

    items.forEach((item, index) => {
      // Add day marker if this is the first item or if day changed
      if (index === 0) {
        result.push({
          type: "day-marker",
          label: formatDayMarker(item.timestamp),
          timestamp: item.timestamp,
        });
      } else if (isDifferentDay(items[index - 1].timestamp, item.timestamp)) {
        result.push({
          type: "day-marker",
          label: formatDayMarker(item.timestamp),
          timestamp: item.timestamp,
        });
      }

      result.push({ type: "item", data: item });
    });

    return result;
  }, [items]);

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (loadFailed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <p className="text-sm text-muted-foreground text-center">
          Failed to load transaction history
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 size-4" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  // Empty state
  if (itemsWithMarkers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <Virtuoso
      data={itemsWithMarkers}
      endReached={hasMore ? onLoadMore : undefined}
      itemContent={(index, item) => {
        if (item.type === "day-marker") {
          return (
            <div
              className="flex justify-center py-2"
              key={`marker-${item.timestamp}`}
            >
              <Label className="text-[10px] text-muted-foreground">
                {item.label}
              </Label>
            </div>
          );
        }

        return renderItem(item.data, index);
      }}
      components={{
        Footer: () =>
          loadingMore ? (
            <div className="flex justify-center py-4 border-b border-border">
              <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : !hasMore && items.length > 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground border-b border-border">
              No more transactions
            </div>
          ) : null,
      }}
    />
  );
}
