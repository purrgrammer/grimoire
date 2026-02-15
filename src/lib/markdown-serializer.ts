import { nip19 } from "nostr-tools";
import type {
  EmojiTag,
  BlobAttachment,
  SerializedContent,
} from "@/components/editor/MentionEditor";

/**
 * Serialize a Tiptap/ProseMirror document to markdown.
 *
 * Handles standard markdown formatting (headings, bold, italic, code, lists,
 * blockquotes, links, horizontal rules) plus Nostr-specific nodes (mentions,
 * custom emojis, blob attachments, event previews).
 *
 * Returns both the markdown string and extracted metadata (emoji tags, blob
 * attachments, address refs) needed for building Nostr events.
 */
export function serializeEditorToMarkdown(editor: any): SerializedContent {
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

  const ctx = {
    emojiTags,
    blobAttachments,
    addressRefs,
    seenEmojis,
    seenBlobs,
    seenAddrs,
  };

  const doc = editor.state.doc;
  const text = serializeBlocks(doc, ctx, "");

  return { text, emojiTags, blobAttachments, addressRefs };
}

interface SerializerContext {
  emojiTags: EmojiTag[];
  blobAttachments: BlobAttachment[];
  addressRefs: Array<{ kind: number; pubkey: string; identifier: string }>;
  seenEmojis: Set<string>;
  seenBlobs: Set<string>;
  seenAddrs: Set<string>;
}

/**
 * Serialize all block-level children of a node, joined by double newlines.
 */
function serializeBlocks(
  node: any,
  ctx: SerializerContext,
  indent: string,
): string {
  const blocks: string[] = [];

  node.forEach((child: any) => {
    const result = serializeBlock(child, ctx, indent);
    if (result !== null) {
      blocks.push(result);
    }
  });

  return blocks.join("\n\n");
}

/**
 * Serialize a single block-level node to markdown.
 */
function serializeBlock(
  node: any,
  ctx: SerializerContext,
  indent: string,
): string | null {
  switch (node.type.name) {
    case "paragraph":
      return indent + serializeInline(node, ctx);

    case "heading": {
      const level = node.attrs.level || 1;
      const prefix = "#".repeat(Math.min(level, 6));
      return `${indent}${prefix} ${serializeInline(node, ctx)}`;
    }

    case "codeBlock": {
      const lang = node.attrs.language || "";
      const code = node.textContent;
      return `${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\``;
    }

    case "blockquote": {
      const inner = serializeBlocks(node, ctx, "");
      return inner
        .split("\n")
        .map((line) => `${indent}> ${line}`)
        .join("\n");
    }

    case "bulletList": {
      const items: string[] = [];
      node.forEach((item: any) => {
        const content = serializeListItemContent(item, ctx, indent + "  ");
        items.push(`${indent}- ${content}`);
      });
      return items.join("\n");
    }

    case "orderedList": {
      const items: string[] = [];
      const start = node.attrs.start || 1;
      node.forEach((item: any, _offset: number, idx: number) => {
        const num = start + idx;
        const content = serializeListItemContent(item, ctx, indent + "   ");
        items.push(`${indent}${num}. ${content}`);
      });
      return items.join("\n");
    }

    case "horizontalRule":
      return `${indent}---`;

    case "blobAttachment": {
      const { url, sha256, mimeType, size, server } = node.attrs;
      if (!ctx.seenBlobs.has(sha256)) {
        ctx.seenBlobs.add(sha256);
        ctx.blobAttachments.push({ url, sha256, mimeType, size, server });
      }
      // Images become markdown images, others just the URL
      if (mimeType?.startsWith("image/")) {
        return `${indent}![](${url})`;
      }
      return `${indent}${url}`;
    }

    case "nostrEventPreview": {
      const { type, data } = node.attrs;
      // Collect address refs for manual a-tags
      if (type === "naddr" && data) {
        const key = `${data.kind}:${data.pubkey}:${data.identifier || ""}`;
        if (!ctx.seenAddrs.has(key)) {
          ctx.seenAddrs.add(key);
          ctx.addressRefs.push({
            kind: data.kind,
            pubkey: data.pubkey,
            identifier: data.identifier || "",
          });
        }
      }
      return `${indent}${renderNostrEventPreviewText(type, data)}`;
    }

    default:
      // For unknown block nodes, try to get text content
      if (node.textContent) {
        return indent + node.textContent;
      }
      return null;
  }
}

/**
 * Serialize a list item's children. The first paragraph is inlined,
 * subsequent blocks get their own lines with indentation.
 */
function serializeListItemContent(
  item: any,
  ctx: SerializerContext,
  continuationIndent: string,
): string {
  const parts: string[] = [];
  let first = true;

  item.forEach((child: any) => {
    if (first) {
      // First child is inlined (no leading indent)
      parts.push(serializeBlock(child, ctx, "") || "");
      first = false;
    } else {
      // Subsequent children get continuation indent
      parts.push(serializeBlock(child, ctx, continuationIndent) || "");
    }
  });

  return parts.join("\n");
}

/**
 * Serialize inline content of a block node (text with marks + inline nodes).
 */
function serializeInline(node: any, ctx: SerializerContext): string {
  let result = "";

  node.forEach((child: any) => {
    if (child.isText) {
      let text = child.text || "";
      // Apply marks — order matters: link wraps bold wraps italic etc.
      const marks = [...child.marks].sort(markPriority);
      for (const mark of marks) {
        text = applyMark(mark, text);
      }
      result += text;
    } else {
      result += serializeInlineNode(child, ctx);
    }
  });

  return result;
}

/**
 * Sort marks so nesting is correct: innermost marks first.
 * code < strike < italic < bold < link
 */
function markPriority(a: any, b: any): number {
  const order: Record<string, number> = {
    code: 0,
    strike: 1,
    italic: 2,
    bold: 3,
    link: 4,
  };
  return (order[a.type.name] ?? 5) - (order[b.type.name] ?? 5);
}

/**
 * Wrap text with the markdown syntax for a mark.
 */
function applyMark(mark: any, text: string): string {
  switch (mark.type.name) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "code":
      return `\`${text}\``;
    case "strike":
      return `~~${text}~~`;
    case "link":
      return `[${text}](${mark.attrs.href || ""})`;
    default:
      return text;
  }
}

/**
 * Serialize a non-text inline node (mention, emoji, hardBreak).
 */
function serializeInlineNode(node: any, ctx: SerializerContext): string {
  switch (node.type.name) {
    case "mention": {
      try {
        return `nostr:${nip19.npubEncode(node.attrs.id)}`;
      } catch {
        return `@${node.attrs.label || "unknown"}`;
      }
    }

    case "emoji": {
      const { id, url, source } = node.attrs;
      if (source === "unicode") {
        return url || "";
      }
      // Custom emoji — collect tag
      if (!ctx.seenEmojis.has(id)) {
        ctx.seenEmojis.add(id);
        ctx.emojiTags.push({ shortcode: id, url });
      }
      return `:${id}:`;
    }

    case "hardBreak":
      return "\n";

    default:
      return node.textContent || "";
  }
}

/**
 * Render a nostr event preview node back to its bech32 URI.
 */
function renderNostrEventPreviewText(type: string, data: any): string {
  try {
    switch (type) {
      case "note":
        return `nostr:${nip19.noteEncode(data)}`;
      case "nevent":
        return `nostr:${nip19.neventEncode(data)}`;
      case "naddr":
        return `nostr:${nip19.naddrEncode(data)}`;
      default:
        return "";
    }
  } catch {
    return "";
  }
}
