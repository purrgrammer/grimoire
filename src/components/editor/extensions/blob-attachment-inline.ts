import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BlobAttachmentInline } from "../node-views/BlobAttachmentInline";

/**
 * Inline blob attachment node for MentionEditor (chat-style)
 *
 * Shows a compact badge with media type and size.
 * Uses ReactNodeViewRenderer for React-based rendering.
 */
export const BlobAttachmentInlineNode = Node.create({
  name: "blobAttachment",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      url: { default: null },
      sha256: { default: null },
      mimeType: { default: null },
      size: { default: null },
      server: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-blob-attachment="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-blob-attachment": "true" }),
    ];
  },

  renderText({ node }) {
    return node.attrs.url || "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlobAttachmentInline, {
      as: "span",
      className: "",
    });
  },
});
