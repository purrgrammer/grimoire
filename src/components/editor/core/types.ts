/**
 * Shared types for editor components
 */

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
 * Address reference for a-tags (from naddr)
 */
export interface AddressRef {
  kind: number;
  pubkey: string;
  identifier: string;
}

/**
 * Result of serializing editor content
 * Note: mentions, event quotes, and hashtags are extracted automatically by applesauce
 * from the text content (nostr: URIs and #hashtags), so we don't need to extract them here.
 */
export interface SerializedContent {
  /** The text content with mentions as nostr: URIs and emoji as :shortcode: */
  text: string;
  /** Emoji tags to include in the event (NIP-30) */
  emojiTags: EmojiTag[];
  /** Blob attachments for imeta tags (NIP-92) */
  blobAttachments: BlobAttachment[];
  /** Referenced addresses for a tags (from naddr - not yet handled by applesauce) */
  addressRefs: AddressRef[];
}

/**
 * Common editor handle interface
 */
export interface BaseEditorHandle {
  focus: () => void;
  clear: () => void;
  getContent: () => string;
  getSerializedContent: () => SerializedContent;
  isEmpty: () => boolean;
  submit: () => void;
  /** Insert text at the current cursor position */
  insertText: (text: string) => void;
  /** Insert a blob attachment */
  insertBlob: (blob: BlobAttachment) => void;
}

/**
 * Extended editor handle with JSON state support (for drafts)
 */
export interface TextEditorHandle extends BaseEditorHandle {
  /** Get editor state as JSON (for persistence) */
  getJSON: () => any;
  /** Set editor content from JSON (for restoration) */
  setContent: (json: any) => void;
  /** Get the underlying TipTap editor instance (for toolbar integration) */
  getEditor: () => any | null;
}
