import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BlobAttachmentRich } from "../node-views/BlobAttachmentRich";

/**
 * Rich blob attachment node for long-form editors
 *
 * Uses React components to render full-size image/video previews
 */
export const BlobAttachmentRichNode = Node.create({
  name: "blobAttachment",
  group: "block",
  inline: false,
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
    return [
      {
        tag: 'div[data-blob-attachment="true"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-blob-attachment": "true" }),
    ];
  },

  renderText({ node }) {
    // Serialize to URL for plain text export
    return node.attrs.url || "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlobAttachmentRich);
  },
});
