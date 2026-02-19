import Mention from "@tiptap/extension-mention";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { EmojiNodeView } from "../node-views/EmojiNodeView";

/**
 * Shared emoji extension for both RichEditor and MentionEditor
 *
 * Extends the Mention extension with emoji-specific attributes (url, source)
 * and uses a React node view for rendering.
 */
export const EmojiMention = Mention.extend({
  name: "emoji",

  addAttributes() {
    return {
      ...this.parent?.(),
      url: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-url"),
        renderHTML: (attributes) => {
          if (!attributes.url) return {};
          return { "data-url": attributes.url };
        },
      },
      source: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source"),
        renderHTML: (attributes) => {
          if (!attributes.source) return {};
          return { "data-source": attributes.source };
        },
      },
    };
  },

  renderText({ node }) {
    // Return the emoji character for unicode, or shortcode for custom
    // This is what gets copied to clipboard
    if (node.attrs.source === "unicode") {
      return node.attrs.url || "";
    }
    return `:${node.attrs.id}:`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmojiNodeView, {
      // Render as inline span, not a block-level wrapper
      as: "span",
      className: "",
    });
  },
});
