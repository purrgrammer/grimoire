/**
 * Editor content serialization utilities
 *
 * Converts TipTap editor content to plain text with Nostr-specific handling:
 * - Mentions → nostr:npub...
 * - Emojis → :shortcode: (custom) or unicode character
 * - Event references → nostr:note.../nevent.../naddr...
 * - Blob attachments → URL
 *
 * Also extracts metadata for NIP tags:
 * - Custom emoji tags (NIP-30)
 * - Blob attachments for imeta tags (NIP-92)
 * - Address references for a tags (naddr)
 */

import { nip19 } from "nostr-tools";
import type { Editor } from "@tiptap/react";
import type {
  SerializedContent,
  EmojiTag,
  BlobAttachment,
  AddressRef,
} from "./types";

/**
 * Serialize editor content using getText + descendants walk
 * Used by TextEditor (block-level nodes)
 */
export function serializeEditorContent(editor: Editor): SerializedContent {
  const emojiTags: EmojiTag[] = [];
  const blobAttachments: BlobAttachment[] = [];
  const addressRefs: AddressRef[] = [];
  const seenEmojis = new Set<string>();
  const seenBlobs = new Set<string>();
  const seenAddrs = new Set<string>();

  // Get plain text representation with single newline between blocks
  // (TipTap's default is double newline which adds extra blank lines)
  const text = editor.getText({ blockSeparator: "\n" });

  // Walk the document to collect emoji, blob, and address reference data
  editor.state.doc.descendants((node) => {
    if (node.type.name === "emoji") {
      const { id, url, source } = node.attrs;
      // Only add custom emojis (not unicode) and avoid duplicates
      if (source !== "unicode" && !seenEmojis.has(id)) {
        seenEmojis.add(id);
        emojiTags.push({ shortcode: id, url });
      }
    } else if (node.type.name === "blobAttachment") {
      const { url, sha256, mimeType, size, server } = node.attrs;
      // Avoid duplicates
      if (sha256 && !seenBlobs.has(sha256)) {
        seenBlobs.add(sha256);
        blobAttachments.push({ url, sha256, mimeType, size, server });
      }
    } else if (node.type.name === "nostrEventPreview") {
      // Extract address references (naddr) for manual a tags
      // Note: applesauce handles note/nevent automatically from nostr: URIs
      const { type, data } = node.attrs;
      if (type === "naddr" && data) {
        const addrKey = `${data.kind}:${data.pubkey}:${data.identifier || ""}`;
        if (!seenAddrs.has(addrKey)) {
          seenAddrs.add(addrKey);
          addressRefs.push({
            kind: data.kind,
            pubkey: data.pubkey,
            identifier: data.identifier || "",
          });
        }
      }
    }
  });

  return {
    text,
    emojiTags,
    blobAttachments,
    addressRefs,
  };
}

/**
 * Serialize editor content by walking JSON structure
 * Used by ChatEditor (inline nodes)
 */
export function serializeEditorContentFromJSON(
  editor: Editor,
): SerializedContent {
  let text = "";
  const emojiTags: EmojiTag[] = [];
  const blobAttachments: BlobAttachment[] = [];
  const addressRefs: AddressRef[] = [];
  const seenEmojis = new Set<string>();
  const seenBlobs = new Set<string>();
  const seenAddrs = new Set<string>();
  const json = editor.getJSON();

  json.content?.forEach((node: any) => {
    if (node.type === "paragraph") {
      node.content?.forEach((child: any) => {
        if (child.type === "text") {
          text += child.text;
        } else if (child.type === "hardBreak") {
          // Preserve newlines from Shift+Enter
          text += "\n";
        } else if (child.type === "mention") {
          const pubkey = child.attrs?.id;
          if (pubkey) {
            try {
              const npub = nip19.npubEncode(pubkey);
              text += `nostr:${npub}`;
            } catch {
              // Fallback to display name if encoding fails
              text += `@${child.attrs?.label || "unknown"}`;
            }
          }
        } else if (child.type === "emoji") {
          const shortcode = child.attrs?.id;
          const url = child.attrs?.url;
          const source = child.attrs?.source;

          if (source === "unicode" && url) {
            // Unicode emoji - output the actual character
            text += url;
          } else if (shortcode) {
            // Custom emoji - output :shortcode: and add tag
            text += `:${shortcode}:`;

            if (url && !seenEmojis.has(shortcode)) {
              seenEmojis.add(shortcode);
              emojiTags.push({ shortcode, url });
            }
          }
        } else if (child.type === "blobAttachment") {
          // Blob attachment - output URL and track for imeta tag
          const { url, sha256, mimeType, size, server } = child.attrs;
          if (url) {
            text += url;
            // Add to blob attachments for imeta tags (dedupe by sha256)
            if (sha256 && !seenBlobs.has(sha256)) {
              seenBlobs.add(sha256);
              blobAttachments.push({
                url,
                sha256,
                mimeType: mimeType || undefined,
                size: size || undefined,
                server: server || undefined,
              });
            }
          }
        } else if (child.type === "nostrEventPreview") {
          // Nostr event preview - serialize back to nostr: URI
          const { type, data } = child.attrs;
          try {
            if (type === "note") {
              text += `nostr:${nip19.noteEncode(data)}`;
            } else if (type === "nevent") {
              text += `nostr:${nip19.neventEncode(data)}`;
            } else if (type === "naddr") {
              text += `nostr:${nip19.naddrEncode(data)}`;
              // Extract addressRefs for manual a tags (applesauce doesn't handle naddr yet)
              const addrKey = `${data.kind}:${data.pubkey}:${data.identifier || ""}`;
              if (!seenAddrs.has(addrKey)) {
                seenAddrs.add(addrKey);
                addressRefs.push({
                  kind: data.kind,
                  pubkey: data.pubkey,
                  identifier: data.identifier || "",
                });
              }
            }
          } catch (err) {
            console.error(
              "[serializeEditorContent] Failed to serialize nostr preview:",
              err,
            );
          }
        }
      });
      text += "\n";
    }
  });

  return {
    text: text.trim(),
    emojiTags,
    blobAttachments,
    addressRefs,
  };
}

/**
 * Create empty serialized content
 */
export function emptySerializedContent(): SerializedContent {
  return {
    text: "",
    emojiTags: [],
    blobAttachments: [],
    addressRefs: [],
  };
}
