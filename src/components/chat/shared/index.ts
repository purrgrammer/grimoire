/**
 * Generic chat components - Protocol-agnostic UI components for building chat interfaces
 * These components handle layout, virtualization, and basic interactions but don't know
 * about specific protocols (Nostr, Matrix, XMPP, etc.)
 */

export { ChatWindow } from "./ChatWindow";
export { ChatHeader } from "./ChatHeader";
export { MessageList, useMessageListRef } from "./MessageList";
export { MessageComposer, useMessageComposerRef } from "./MessageComposer";
export { DayMarker } from "./DayMarker";

export {
  formatDayMarker,
  isDifferentDay,
  insertDayMarkers,
} from "./date-utils";

export type {
  DisplayMessage,
  ChatHeaderInfo,
  ChatLoadingState,
  MessageListItem,
} from "./types";

export type { MessageListHandle } from "./MessageList";
export type { MessageComposerHandle } from "./MessageComposer";
