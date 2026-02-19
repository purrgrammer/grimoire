import type { Editor } from "@tiptap/core";
import type {
  Node as ProseMirrorNode,
  Mark as ProseMirrorMark,
} from "@tiptap/pm/model";
import { nip19 } from "nostr-tools";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
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
export function serializeEditorToMarkdown(editor: Editor): SerializedContent {
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

  const ctx: SerializerContext = {
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
  node: ProseMirrorNode,
  ctx: SerializerContext,
  indent: string,
): string {
  const blocks: string[] = [];

  node.forEach((child) => {
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
  node: ProseMirrorNode,
  ctx: SerializerContext,
  indent: string,
): string | null {
  switch (node.type.name) {
    case "paragraph":
      return indent + serializeInline(node, ctx);

    case "heading": {
      const level = (node.attrs.level as number) || 1;
      const prefix = "#".repeat(Math.min(level, 6));
      return `${indent}${prefix} ${serializeInline(node, ctx)}`;
    }

    case "codeBlock": {
      const lang = (node.attrs.language as string) || "";
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
      node.forEach((item) => {
        const content = serializeListItemContent(item, ctx, indent + "  ");
        items.push(`${indent}- ${content}`);
      });
      return items.join("\n");
    }

    case "orderedList": {
      const items: string[] = [];
      const start = (node.attrs.start as number) || 1;
      node.forEach((item, _offset, idx) => {
        const num = start + idx;
        const content = serializeListItemContent(item, ctx, indent + "   ");
        items.push(`${indent}${num}. ${content}`);
      });
      return items.join("\n");
    }

    case "horizontalRule":
      return `${indent}---`;

    case "blobAttachment": {
      const url = node.attrs.url as string;
      const sha256 = node.attrs.sha256 as string;
      const mimeType = node.attrs.mimeType as string | undefined;
      const size = node.attrs.size as number | undefined;
      const server = node.attrs.server as string | undefined;
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
      const previewType = node.attrs.type as string;
      const previewData = node.attrs.data as
        | string
        | EventPointer
        | AddressPointer;
      // Collect address refs for manual a-tags
      if (previewType === "naddr" && previewData) {
        const addr = previewData as AddressPointer;
        const key = `${addr.kind}:${addr.pubkey}:${addr.identifier || ""}`;
        if (!ctx.seenAddrs.has(key)) {
          ctx.seenAddrs.add(key);
          ctx.addressRefs.push({
            kind: addr.kind,
            pubkey: addr.pubkey,
            identifier: addr.identifier || "",
          });
        }
      }
      return `${indent}${renderNostrEventPreviewText(previewType, previewData)}`;
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
  item: ProseMirrorNode,
  ctx: SerializerContext,
  continuationIndent: string,
): string {
  const parts: string[] = [];
  let first = true;

  item.forEach((child) => {
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
function serializeInline(
  node: ProseMirrorNode,
  ctx: SerializerContext,
): string {
  let result = "";

  node.forEach((child) => {
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
function markPriority(a: ProseMirrorMark, b: ProseMirrorMark): number {
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
function applyMark(mark: ProseMirrorMark, text: string): string {
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
      return `[${text}](${(mark.attrs.href as string) || ""})`;
    default:
      return text;
  }
}

/**
 * Serialize a non-text inline node (mention, emoji, hardBreak).
 */
function serializeInlineNode(
  node: ProseMirrorNode,
  ctx: SerializerContext,
): string {
  switch (node.type.name) {
    case "mention": {
      try {
        return `nostr:${nip19.npubEncode(node.attrs.id as string)}`;
      } catch {
        return `@${(node.attrs.label as string) || "unknown"}`;
      }
    }

    case "emoji": {
      const id = node.attrs.id as string;
      const url = node.attrs.url as string;
      const source = node.attrs.source as string;
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
function renderNostrEventPreviewText(
  type: string,
  data: string | EventPointer | AddressPointer,
): string {
  try {
    switch (type) {
      case "note":
        return `nostr:${nip19.noteEncode(data as string)}`;
      case "nevent":
        return `nostr:${nip19.neventEncode(data as EventPointer)}`;
      case "naddr":
        return `nostr:${nip19.naddrEncode(data as AddressPointer)}`;
      default:
        return "";
    }
  } catch {
    return "";
  }
}
