import { nip19 } from "nostr-tools";
import type { Editor } from "@tiptap/core";
import type { EmojiTag, BlobAttachment, SerializedContent } from "../types";

/**
 * Serialize RichEditor content to plain text with nostr: URIs
 *
 * Walks the ProseMirror document tree to extract emoji tags, blob attachments,
 * and address references. Mentions, event quotes, and hashtags are extracted
 * automatically by applesauce from the text content.
 */
export function serializeRichContent(editor: Editor): SerializedContent {
  const emojiTags: EmojiTag[] = [];
  const blobAttachments: BlobAttachment[] = [];
  const addressRefs: Array<{
    kind: number;
    pubkey: string;
    identifier: string;
  }> = [];
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
      if (url && sha256 && !seenBlobs.has(sha256)) {
        seenBlobs.add(sha256);
        blobAttachments.push({ url, sha256, mimeType, size, server });
      }
    } else if (node.type.name === "nostrEventPreview") {
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

  return { text, emojiTags, blobAttachments, addressRefs };
}

/**
 * Serialize MentionEditor content by walking the JSON structure
 *
 * MentionEditor uses inline nodes (not block-level), so we walk the JSON
 * to reconstruct text with nostr: URIs for mentions and :shortcode: for custom emoji.
 */
export function serializeInlineContent(editor: Editor): SerializedContent {
  let text = "";
  const emojiTags: EmojiTag[] = [];
  const blobAttachments: BlobAttachment[] = [];
  const addressRefs: Array<{
    kind: number;
    pubkey: string;
    identifier: string;
  }> = [];
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
          text += "\n";
        } else if (child.type === "mention") {
          const pubkey = child.attrs?.id;
          if (pubkey) {
            try {
              const npub = nip19.npubEncode(pubkey);
              text += `nostr:${npub}`;
            } catch {
              text += `@${child.attrs?.label || "unknown"}`;
            }
          }
        } else if (child.type === "emoji") {
          const shortcode = child.attrs?.id;
          const url = child.attrs?.url;
          const source = child.attrs?.source;

          if (source === "unicode" && url) {
            text += url;
          } else if (shortcode) {
            text += `:${shortcode}:`;
            if (url && !seenEmojis.has(shortcode)) {
              seenEmojis.add(shortcode);
              emojiTags.push({ shortcode, url });
            }
          }
        } else if (child.type === "blobAttachment") {
          const { url, sha256, mimeType, size, server } = child.attrs;
          if (url) {
            text += url;
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
          const { type, data } = child.attrs;
          try {
            if (type === "note") {
              text += `nostr:${nip19.noteEncode(data)}`;
            } else if (type === "nevent") {
              text += `nostr:${nip19.neventEncode(data)}`;
            } else if (type === "naddr") {
              text += `nostr:${nip19.naddrEncode(data)}`;
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
              "[serializeInlineContent] Failed to serialize nostr preview:",
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

/** Format byte size to human-readable string */
export function formatBlobSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
