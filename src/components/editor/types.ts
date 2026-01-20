import type { ComponentType } from "react";

/**
 * Represents an emoji tag for NIP-30
 */
export interface EmojiTag {
  shortcode: string;
  url: string;
}

/**
 * Represents a blob attachment for imeta tags (NIP-92)
 */
export interface BlobAttachment {
  /** The URL of the blob */
  url: string;
  /** SHA256 hash of the blob content */
  sha256: string;
  /** MIME type of the blob */
  mimeType?: string;
  /** Size in bytes */
  size?: number;
  /** Blossom server URL */
  server?: string;
}

/**
 * Result of serializing editor content
 */
export interface SerializedContent {
  /** The text content with mentions as nostr: URIs and emoji as :shortcode: */
  text: string;
  /** Emoji tags to include in the event (NIP-30) */
  emojiTags: EmojiTag[];
  /** Blob attachments for imeta tags (NIP-92) */
  blobAttachments: BlobAttachment[];
}

/**
 * Props for suggestion list components
 */
export interface SuggestionListProps<T> {
  items: T[];
  command: (item: T) => void;
  onClose?: () => void;
}

/**
 * Handle for suggestion list components (keyboard navigation)
 */
export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Configuration for a suggestion type
 */
export interface SuggestionConfig<T = unknown> {
  /** Trigger character (e.g., "@", ":", "/") */
  char: string;
  /** Search function to find suggestions */
  search: (query: string) => Promise<T[]>;
  /** Component to render the suggestion list */
  component: ComponentType<
    SuggestionListProps<T> & { ref?: React.Ref<SuggestionListHandle> }
  >;
  /** Command to execute when item is selected - transforms item to TipTap node attrs */
  onSelect: (item: T) => {
    type: string;
    attrs: Record<string, unknown>;
  };
  /** Whether to allow spaces in the query */
  allowSpaces?: boolean;
  /** Custom allow function (e.g., only at start of input) */
  allow?: (props: { range: { from: number; to: number } }) => boolean;
  /** Popup placement */
  placement?: "top-start" | "bottom-start";
  /** Optional callback when command is executed (e.g., for slash commands) */
  onExecute?: (item: T) => Promise<void>;
  /** Whether selection should clear the trigger text (for slash commands) */
  clearOnSelect?: boolean;
}

/**
 * Submit behavior configuration
 */
export type SubmitBehavior =
  | "enter" // Enter submits (desktop chat default), Shift+Enter for newline
  | "ctrl-enter" // Only Ctrl/Cmd+Enter submits, Enter inserts newline
  | "button-only"; // No keyboard submit, rely on external button

/**
 * Layout variant for the editor
 */
export type EditorVariant =
  | "inline" // Single-line chat input (current chat behavior)
  | "multiline" // Auto-expanding textarea
  | "full"; // Full editor with fixed height and scroll

/**
 * Blob preview style
 */
export type BlobPreviewStyle =
  | "compact" // Small inline pill (current chat behavior)
  | "card" // Medium card with thumbnail
  | "gallery"; // Full-width image gallery

/**
 * Handle exposed by NostrEditor for imperative control
 */
export interface NostrEditorHandle {
  focus: () => void;
  clear: () => void;
  getContent: () => string;
  getSerializedContent: () => SerializedContent;
  /** Get the full TipTap JSON content (for draft persistence) */
  getJSON: () => object | null;
  /** Set content from string or TipTap JSON */
  setContent: (content: string | object) => void;
  isEmpty: () => boolean;
  submit: () => void;
  /** Insert text at the current cursor position */
  insertText: (text: string) => void;
  /** Insert a blob attachment with rich preview */
  insertBlob: (blob: BlobAttachment) => void;
}
