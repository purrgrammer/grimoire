import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { nip19 } from "nostr-tools";
import { NostrEventPreviewInline } from "../node-views/NostrEventPreviewInline";

/**
 * Inline Nostr event preview node for MentionEditor (chat-style)
 *
 * Shows a compact badge with event type and truncated ID.
 * Uses ReactNodeViewRenderer for React-based rendering.
 */
export const NostrEventPreviewInlineNode = Node.create({
  name: "nostrEventPreview",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      type: { default: null }, // 'note' | 'nevent' | 'naddr'
      data: { default: null }, // Decoded bech32 data
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-nostr-preview="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-nostr-preview": "true" }),
    ];
  },

  renderText({ node }) {
    const { type, data } = node.attrs;
    try {
      if (type === "note") return `nostr:${nip19.noteEncode(data)}`;
      if (type === "nevent") return `nostr:${nip19.neventEncode(data)}`;
      if (type === "naddr") return `nostr:${nip19.naddrEncode(data)}`;
    } catch (err) {
      console.error("[NostrEventPreviewInline] Failed to encode:", err);
    }
    return "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(NostrEventPreviewInline, {
      as: "span",
      className: "",
    });
  },
});
