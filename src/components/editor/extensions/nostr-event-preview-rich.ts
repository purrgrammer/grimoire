import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { NostrEventPreviewRich } from "../node-views/NostrEventPreviewRich";
import { nip19 } from "nostr-tools";

/**
 * Rich Nostr event preview node for long-form editors
 *
 * Uses React components to render full event previews with KindRenderer
 */
export const NostrEventPreviewRichNode = Node.create({
  name: "nostrEventPreview",
  group: "block",
  inline: false,
  atom: true,

  addAttributes() {
    return {
      type: { default: null }, // 'note' | 'nevent' | 'naddr'
      data: { default: null }, // Decoded bech32 data (varies by type)
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-nostr-preview="true"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-nostr-preview": "true" }),
    ];
  },

  renderText({ node }) {
    // Serialize back to nostr: URI for plain text export
    const { type, data } = node.attrs;
    try {
      if (type === "note") {
        return `nostr:${nip19.noteEncode(data)}`;
      } else if (type === "nevent") {
        return `nostr:${nip19.neventEncode(data)}`;
      } else if (type === "naddr") {
        return `nostr:${nip19.naddrEncode(data)}`;
      }
    } catch (err) {
      console.error("[NostrEventPreviewRich] Failed to encode:", err);
    }
    return "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(NostrEventPreviewRich);
  },
});
