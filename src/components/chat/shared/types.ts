/**
 * Generic types for chat components
 * These types are protocol-agnostic and can be used for any chat implementation
 */

/**
 * Generic message type for display
 * Flexible base interface that can be extended by protocol-specific implementations
 */
export interface DisplayMessage {
  id: string;
  author: string;
  content: string;
  timestamp: number;
  type?: "user" | "system" | "zap";
  replyTo?: string;
  metadata?: unknown; // Flexible to allow protocol-specific metadata
}

/**
 * Chat header info
 */
export interface ChatHeaderInfo {
  title: string;
  subtitle?: string;
  icon?: string;
}

/**
 * Loading states for chat
 */
export type ChatLoadingState = "idle" | "loading" | "error" | "success";

/**
 * Item in the message list (message or day marker)
 * Generic to support protocol-specific message types
 */
export type MessageListItem<
  T extends { id: string; timestamp: number } = DisplayMessage,
> =
  | { type: "message"; data: T }
  | { type: "day-marker"; data: string; timestamp: number };
