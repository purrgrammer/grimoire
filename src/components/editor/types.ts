/**
 * Shared types for editor components
 */

/**
 * Represents an emoji tag for NIP-30
 */
export interface EmojiTag {
  shortcode: string;
  url: string;
  /** NIP-30 optional 4th tag: "30030:pubkey:identifier" address of the emoji set */
  address?: string;
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
  /**
   * A local `blob:` URL for the ORIGINAL bytes, for the composer preview only.
   *
   * An encrypted attachment's `url` serves ciphertext, so pointing an `<img>`
   * at it draws a broken image. The sender still has the plaintext in hand at
   * upload time; this carries it to the badge and is never published.
   */
  previewUrl?: string;
  /** Ciphertext on the server — the badge must not fetch `url` to draw it. */
  encrypted?: boolean;
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
  addressRefs: Array<{ kind: number; pubkey: string; identifier: string }>;
}
