// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { nip19 } from "nostr-tools";

// Mock React node views
vi.mock("@tiptap/react", () => ({
  ReactNodeViewRenderer: () => () => null,
}));
vi.mock("../node-views/EmojiNodeView", () => ({ EmojiNodeView: {} }));
vi.mock("../node-views/BlobAttachmentRich", () => ({
  BlobAttachmentRich: {},
}));
vi.mock("../node-views/BlobAttachmentInline", () => ({
  BlobAttachmentInline: {},
}));
vi.mock("../node-views/NostrEventPreviewRich", () => ({
  NostrEventPreviewRich: {},
}));
vi.mock("../node-views/NostrEventPreviewInline", () => ({
  NostrEventPreviewInline: {},
}));

import { EmojiMention } from "../extensions/emoji";
import { BlobAttachmentRichNode } from "../extensions/blob-attachment-rich";
import { BlobAttachmentInlineNode } from "../extensions/blob-attachment-inline";
import { NostrEventPreviewRichNode } from "../extensions/nostr-event-preview-rich";
import { NostrEventPreviewInlineNode } from "../extensions/nostr-event-preview-inline";
import {
  serializeRichContent,
  serializeInlineContent,
  formatBlobSize,
} from "./serialize";

beforeAll(() => {
  const rect = {
    x: 0,
    y: 0,
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    toJSON: () => ({}),
  };
  HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = (() => []) as any;
  document.elementFromPoint = (() => null) as any;
});

// Test data
const TEST_PUBKEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
const TEST_EVENT_ID =
  "d7a9c9f8e7b6a5d4c3b2a1f0e9d8c7b6a5d4c3b2a1f0e9d8c7b6a5d4c3b2a1f0";

/** Create a rich editor (block-level attachments, NostrEventPreview, emoji) */
function createRichEditor(content?: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Mention.configure({ suggestion: { char: "@" } }),
      EmojiMention.configure({ suggestion: { char: ":" } }),
      BlobAttachmentRichNode,
      NostrEventPreviewRichNode,
    ],
    content,
  });
}

/** Create an inline editor (inline attachments, NostrEventPreview, emoji) */
function createInlineEditor(content?: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Mention.configure({ suggestion: { char: "@" } }),
      EmojiMention.configure({ suggestion: { char: ":" } }),
      BlobAttachmentInlineNode,
      NostrEventPreviewInlineNode,
    ],
    content,
  });
}

describe("formatBlobSize", () => {
  it("should format bytes", () => {
    expect(formatBlobSize(100)).toBe("100B");
    expect(formatBlobSize(0)).toBe("0B");
    expect(formatBlobSize(1023)).toBe("1023B");
  });

  it("should format kilobytes", () => {
    expect(formatBlobSize(1024)).toBe("1KB");
    expect(formatBlobSize(2048)).toBe("2KB");
    expect(formatBlobSize(512 * 1024)).toBe("512KB");
  });

  it("should format megabytes", () => {
    expect(formatBlobSize(1024 * 1024)).toBe("1.0MB");
    expect(formatBlobSize(1.5 * 1024 * 1024)).toBe("1.5MB");
    expect(formatBlobSize(10 * 1024 * 1024)).toBe("10.0MB");
  });

  it("should handle boundary values", () => {
    // Just under 1KB
    expect(formatBlobSize(1023)).toBe("1023B");
    // Exactly 1KB
    expect(formatBlobSize(1024)).toBe("1KB");
    // Just under 1MB
    expect(formatBlobSize(1024 * 1024 - 1)).toBe("1024KB");
    // Exactly 1MB
    expect(formatBlobSize(1024 * 1024)).toBe("1.0MB");
  });

  it("should handle zero", () => {
    expect(formatBlobSize(0)).toBe("0B");
  });

  it("should handle very large values (no GB formatting)", () => {
    // 1 GB displayed as MB
    expect(formatBlobSize(1024 * 1024 * 1024)).toBe("1024.0MB");
  });
});

describe("serializeRichContent", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  describe("text extraction", () => {
    it("should extract plain text", () => {
      editor = createRichEditor("<p>Hello world</p>");
      const result = serializeRichContent(editor);
      expect(result.text).toBe("Hello world");
    });

    it("should use single newline between blocks", () => {
      editor = createRichEditor("<p>Line 1</p><p>Line 2</p>");
      const result = serializeRichContent(editor);
      expect(result.text).toBe("Line 1\nLine 2");
    });
  });

  describe("emoji extraction", () => {
    it("should collect custom emoji tags", () => {
      editor = createRichEditor();
      editor.commands.insertContent([
        { type: "text", text: "Hello " },
        {
          type: "emoji",
          attrs: {
            id: "pepe",
            url: "https://cdn.example.com/pepe.png",
            source: "custom",
            mentionSuggestionChar: ":",
          },
        },
      ]);

      const result = serializeRichContent(editor);
      expect(result.emojiTags).toHaveLength(1);
      expect(result.emojiTags[0]).toEqual({
        shortcode: "pepe",
        url: "https://cdn.example.com/pepe.png",
      });
    });

    it("should NOT collect unicode emoji tags", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "fire",
          url: "🔥",
          source: "unicode",
          mentionSuggestionChar: ":",
        },
      });

      const result = serializeRichContent(editor);
      expect(result.emojiTags).toHaveLength(0);
    });

    it("should deduplicate emoji tags", () => {
      editor = createRichEditor();
      editor.commands.insertContent([
        {
          type: "emoji",
          attrs: {
            id: "pepe",
            url: "https://cdn.example.com/pepe.png",
            source: "custom",
            mentionSuggestionChar: ":",
          },
        },
        { type: "text", text: " " },
        {
          type: "emoji",
          attrs: {
            id: "pepe",
            url: "https://cdn.example.com/pepe.png",
            source: "custom",
            mentionSuggestionChar: ":",
          },
        },
      ]);

      const result = serializeRichContent(editor);
      expect(result.emojiTags).toHaveLength(1);
    });
  });

  describe("blob attachment extraction", () => {
    it("should collect blob attachments", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: {
          url: "https://cdn.example.com/image.png",
          sha256: "abc123",
          mimeType: "image/png",
          size: 1024,
          server: "https://blossom.example.com",
        },
      });

      const result = serializeRichContent(editor);
      expect(result.blobAttachments).toHaveLength(1);
      expect(result.blobAttachments[0]).toEqual({
        url: "https://cdn.example.com/image.png",
        sha256: "abc123",
        mimeType: "image/png",
        size: 1024,
        server: "https://blossom.example.com",
      });
    });

    it("should deduplicate blob attachments by sha256", () => {
      editor = createRichEditor();
      editor.commands.insertContent([
        {
          type: "paragraph",
          content: [{ type: "text", text: "First" }],
        },
        {
          type: "blobAttachment",
          attrs: {
            url: "https://cdn.example.com/image.png",
            sha256: "abc123",
            mimeType: "image/png",
            size: 1024,
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second" }],
        },
        {
          type: "blobAttachment",
          attrs: {
            url: "https://cdn.example.com/image.png",
            sha256: "abc123",
            mimeType: "image/png",
            size: 1024,
          },
        },
      ]);

      const result = serializeRichContent(editor);
      expect(result.blobAttachments).toHaveLength(1);
    });
  });

  describe("address reference extraction", () => {
    it("should collect naddr references", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: {
          type: "naddr",
          data: {
            kind: 30023,
            pubkey: TEST_PUBKEY,
            identifier: "my-article",
          },
        },
      });

      const result = serializeRichContent(editor);
      expect(result.addressRefs).toHaveLength(1);
      expect(result.addressRefs[0]).toEqual({
        kind: 30023,
        pubkey: TEST_PUBKEY,
        identifier: "my-article",
      });
    });

    it("should NOT collect note or nevent as address refs", () => {
      editor = createRichEditor();
      editor.commands.insertContent([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        {
          type: "nostrEventPreview",
          attrs: { type: "note", data: TEST_EVENT_ID },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After" }],
        },
        {
          type: "nostrEventPreview",
          attrs: {
            type: "nevent",
            data: { id: TEST_EVENT_ID },
          },
        },
      ]);

      const result = serializeRichContent(editor);
      expect(result.addressRefs).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("should return empty result for empty editor", () => {
      editor = createRichEditor();
      const result = serializeRichContent(editor);
      expect(result.text).toBe("");
      expect(result.emojiTags).toHaveLength(0);
      expect(result.blobAttachments).toHaveLength(0);
      expect(result.addressRefs).toHaveLength(0);
    });

    it("should NOT collect blob attachments with null sha256", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: {
          url: "https://cdn.example.com/image.png",
          sha256: null,
          mimeType: "image/png",
          size: 1024,
        },
      });

      const result = serializeRichContent(editor);
      expect(result.blobAttachments).toHaveLength(0);
    });

    it("should NOT collect blob attachments with null url", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: {
          url: null,
          sha256: "abc123",
          mimeType: "image/png",
          size: 1024,
        },
      });

      const result = serializeRichContent(editor);
      expect(result.blobAttachments).toHaveLength(0);
    });
  });
});

describe("serializeInlineContent", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  describe("text extraction", () => {
    it("should extract plain text", () => {
      editor = createInlineEditor("<p>Hello world</p>");
      const result = serializeInlineContent(editor);
      expect(result.text).toBe("Hello world");
    });
  });

  describe("mention serialization", () => {
    it("should serialize mentions as nostr: URIs", () => {
      editor = createInlineEditor();
      editor.commands.insertContent([
        { type: "text", text: "Hello " },
        {
          type: "mention",
          attrs: { id: TEST_PUBKEY, label: "alice" },
        },
      ]);

      const result = serializeInlineContent(editor);
      const expectedNpub = nip19.npubEncode(TEST_PUBKEY);
      expect(result.text).toContain(`nostr:${expectedNpub}`);
    });
  });

  describe("emoji serialization", () => {
    it("should serialize unicode emoji as character", () => {
      editor = createInlineEditor();
      editor.commands.insertContent([
        { type: "text", text: "Hello " },
        {
          type: "emoji",
          attrs: {
            id: "fire",
            url: "🔥",
            source: "unicode",
            mentionSuggestionChar: ":",
          },
        },
      ]);

      const result = serializeInlineContent(editor);
      expect(result.text).toContain("🔥");
      expect(result.emojiTags).toHaveLength(0);
    });

    it("should serialize custom emoji as :shortcode: and collect tags", () => {
      editor = createInlineEditor();
      editor.commands.insertContent([
        { type: "text", text: "Hello " },
        {
          type: "emoji",
          attrs: {
            id: "pepe",
            url: "https://cdn.example.com/pepe.png",
            source: "custom",
            mentionSuggestionChar: ":",
          },
        },
      ]);

      const result = serializeInlineContent(editor);
      expect(result.text).toContain(":pepe:");
      expect(result.emojiTags).toHaveLength(1);
      expect(result.emojiTags[0]).toEqual({
        shortcode: "pepe",
        url: "https://cdn.example.com/pepe.png",
      });
    });
  });

  describe("blob attachment serialization", () => {
    it("should serialize blob attachments as URLs", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: {
          url: "https://cdn.example.com/image.png",
          sha256: "abc123",
          mimeType: "image/png",
          size: 1024,
        },
      });

      const result = serializeInlineContent(editor);
      expect(result.text).toContain("https://cdn.example.com/image.png");
      expect(result.blobAttachments).toHaveLength(1);
      expect(result.blobAttachments[0].sha256).toBe("abc123");
    });
  });

  describe("nostr event preview serialization", () => {
    it("should serialize note as nostr: URI", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "note", data: TEST_EVENT_ID },
      });

      const result = serializeInlineContent(editor);
      const expectedNote = nip19.noteEncode(TEST_EVENT_ID);
      expect(result.text).toContain(`nostr:${expectedNote}`);
    });

    it("should serialize nevent as nostr: URI", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "nevent", data: { id: TEST_EVENT_ID } },
      });

      const result = serializeInlineContent(editor);
      const expectedNevent = nip19.neventEncode({ id: TEST_EVENT_ID });
      expect(result.text).toContain(`nostr:${expectedNevent}`);
    });

    it("should serialize naddr as nostr: URI and collect address ref", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: {
          type: "naddr",
          data: {
            kind: 30023,
            pubkey: TEST_PUBKEY,
            identifier: "my-article",
          },
        },
      });

      const result = serializeInlineContent(editor);
      const expectedNaddr = nip19.naddrEncode({
        kind: 30023,
        pubkey: TEST_PUBKEY,
        identifier: "my-article",
      });
      expect(result.text).toContain(`nostr:${expectedNaddr}`);
      expect(result.addressRefs).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("should return empty result for empty editor", () => {
      editor = createInlineEditor();
      const result = serializeInlineContent(editor);
      expect(result.text).toBe("");
      expect(result.emojiTags).toHaveLength(0);
      expect(result.blobAttachments).toHaveLength(0);
      expect(result.addressRefs).toHaveLength(0);
    });

    it("should fall back to @label for invalid pubkey in mention", () => {
      editor = createInlineEditor();
      editor.commands.insertContent([
        { type: "text", text: "Hello " },
        {
          type: "mention",
          attrs: { id: "not-a-valid-hex-pubkey", label: "broken" },
        },
      ]);

      const result = serializeInlineContent(editor);
      expect(result.text).toContain("@broken");
    });

    it("should handle mention with missing pubkey", () => {
      editor = createInlineEditor();
      editor.commands.insertContent([
        { type: "text", text: "Hello " },
        {
          type: "mention",
          attrs: { id: null, label: "ghost" },
        },
      ]);

      const result = serializeInlineContent(editor);
      // Mention with null id should be silently dropped
      expect(result.text).not.toContain("nostr:");
      expect(result.text).not.toContain("@ghost");
    });

    it("should handle blob attachment without sha256 (emit URL but not collect)", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: {
          url: "https://cdn.example.com/image.png",
          sha256: null,
          mimeType: "image/png",
        },
      });

      const result = serializeInlineContent(editor);
      expect(result.text).toContain("https://cdn.example.com/image.png");
      expect(result.blobAttachments).toHaveLength(0);
    });

    it("should handle blob attachment without url (skip entirely)", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: { url: null, sha256: "abc123" },
      });

      const result = serializeInlineContent(editor);
      expect(result.text.trim()).toBe("");
      expect(result.blobAttachments).toHaveLength(0);
    });

    it("should deduplicate inline emoji tags", () => {
      editor = createInlineEditor();
      editor.commands.insertContent([
        {
          type: "emoji",
          attrs: {
            id: "pepe",
            url: "https://cdn.example.com/pepe.png",
            source: "custom",
            mentionSuggestionChar: ":",
          },
        },
        { type: "text", text: " " },
        {
          type: "emoji",
          attrs: {
            id: "pepe",
            url: "https://cdn.example.com/pepe.png",
            source: "custom",
            mentionSuggestionChar: ":",
          },
        },
      ]);

      const result = serializeInlineContent(editor);
      expect(result.emojiTags).toHaveLength(1);
    });

    it("should handle multiple paragraphs", () => {
      editor = createInlineEditor("<p>Line 1</p><p>Line 2</p><p>Line 3</p>");
      const result = serializeInlineContent(editor);
      expect(result.text).toBe("Line 1\nLine 2\nLine 3");
    });

    it("should handle empty paragraphs", () => {
      editor = createInlineEditor("<p>Before</p><p></p><p>After</p>");
      const result = serializeInlineContent(editor);
      expect(result.text).toContain("Before");
      expect(result.text).toContain("After");
    });
  });

  describe("combined content", () => {
    it("should handle mixed content correctly", () => {
      editor = createInlineEditor();
      editor.commands.insertContent([
        { type: "text", text: "Hello " },
        {
          type: "mention",
          attrs: { id: TEST_PUBKEY, label: "alice" },
        },
        { type: "text", text: " check this " },
        {
          type: "emoji",
          attrs: {
            id: "fire",
            url: "🔥",
            source: "unicode",
            mentionSuggestionChar: ":",
          },
        },
      ]);

      const result = serializeInlineContent(editor);
      expect(result.text).toContain("Hello");
      expect(result.text).toContain(`nostr:${nip19.npubEncode(TEST_PUBKEY)}`);
      expect(result.text).toContain("check this");
      expect(result.text).toContain("🔥");
    });
  });
});
