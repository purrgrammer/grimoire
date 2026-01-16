/**
 * Generic date utilities for chat
 */
import type { MessageListItem } from "./types";

/**
 * Format timestamp as a readable day marker
 */
export function formatDayMarker(timestamp: number): string {
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
export function isDifferentDay(
  timestamp1: number,
  timestamp2: number,
): boolean {
  const date1 = new Date(timestamp1 * 1000);
  const date2 = new Date(timestamp2 * 1000);

  return (
    date1.getFullYear() !== date2.getFullYear() ||
    date1.getMonth() !== date2.getMonth() ||
    date1.getDate() !== date2.getDate()
  );
}

/**
 * Process messages to include day markers
 * Returns array with messages and day markers interleaved
 */
export function insertDayMarkers<T extends { id: string; timestamp: number }>(
  messages: T[],
): MessageListItem<T>[] {
  if (!messages || messages.length === 0) return [];

  const items: MessageListItem<T>[] = [];

  messages.forEach((message, index) => {
    // Add day marker if this is the first message or if day changed
    if (index === 0) {
      items.push({
        type: "day-marker",
        data: formatDayMarker(message.timestamp),
        timestamp: message.timestamp,
      });
    } else {
      const prevMessage = messages[index - 1];
      if (isDifferentDay(prevMessage.timestamp, message.timestamp)) {
        items.push({
          type: "day-marker",
          data: formatDayMarker(message.timestamp),
          timestamp: message.timestamp,
        });
      }
    }

    // Add the message itself
    items.push({ type: "message", data: message });
  });

  return items;
}
