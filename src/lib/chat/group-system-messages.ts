import type { Message } from "@/types/chat";

/**
 * Grouped system message - multiple users doing the same action
 */
export interface GroupedSystemMessage {
  authors: string[]; // pubkeys of users who performed the action
  content: string; // action text (e.g., "reposted", "joined", "left")
  timestamp: number; // timestamp of the first message in the group
  messageIds: string[]; // IDs of all messages in the group
}

/**
 * Helper: Group consecutive system messages with the same content
 *
 * Takes a list of messages and groups consecutive system messages that have
 * the same action (content). Non-system messages break the grouping.
 *
 * @example
 * Input: [
 *   { type: "system", content: "reposted", author: "alice" },
 *   { type: "system", content: "reposted", author: "bob" },
 *   { type: "user", content: "hello" },
 *   { type: "system", content: "reposted", author: "charlie" }
 * ]
 *
 * Output: [
 *   { authors: ["alice", "bob"], content: "reposted", ... },
 *   { type: "user", content: "hello" },
 *   { authors: ["charlie"], content: "reposted", ... }
 * ]
 */
export function groupSystemMessages(
  messages: Message[],
): Array<Message | GroupedSystemMessage> {
  const result: Array<Message | GroupedSystemMessage> = [];
  let currentGroup: GroupedSystemMessage | null = null;

  for (const message of messages) {
    // Only group system messages (not user or zap messages)
    if (message.type === "system") {
      // Check if we can add to current group
      if (currentGroup && currentGroup.content === message.content) {
        // Add to existing group
        currentGroup.authors.push(message.author);
        currentGroup.messageIds.push(message.id);
      } else {
        // Finalize current group if exists
        if (currentGroup) {
          result.push(currentGroup);
        }
        // Start new group
        currentGroup = {
          authors: [message.author],
          content: message.content,
          timestamp: message.timestamp,
          messageIds: [message.id],
        };
      }
    } else {
      // Non-system message - finalize any pending group
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(message);
    }
  }

  // Don't forget the last group if exists
  if (currentGroup) {
    result.push(currentGroup);
  }

  return result;
}

/**
 * Type guard to check if item is a grouped system message
 */
export function isGroupedSystemMessage(
  item: unknown,
): item is GroupedSystemMessage {
  if (!item || typeof item !== "object") return false;
  const obj = item as Record<string, unknown>;
  return (
    Array.isArray(obj.authors) &&
    obj.authors.length > 0 &&
    typeof obj.content === "string" &&
    typeof obj.timestamp === "number" &&
    Array.isArray(obj.messageIds) &&
    obj.messageIds.length > 0 &&
    obj.authors.length === obj.messageIds.length
  );
}
