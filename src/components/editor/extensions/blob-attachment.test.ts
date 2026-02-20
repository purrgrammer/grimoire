// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

// Mock React node views (not needed for headless tests)
vi.mock("@tiptap/react", () => ({
  ReactNodeViewRenderer: () => () => null,
}));
vi.mock("../node-views/BlobAttachmentRich", () => ({
  BlobAttachmentRich: {},
}));
vi.mock("../node-views/BlobAttachmentInline", () => ({
  BlobAttachmentInline: {},
}));

import { BlobAttachmentRichNode } from "./blob-attachment-rich";
import { BlobAttachmentInlineNode } from "./blob-attachment-inline";

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

const SAMPLE_BLOB = {
  url: "https://cdn.example.com/image.png",
  sha256: "abc123def456",
  mimeType: "image/png",
  size: 1024,
  server: "https://blossom.example.com",
};

describe("BlobAttachmentRichNode (block-level)", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  function createRichEditor(content?: string) {
    return new Editor({
      extensions: [StarterKit, BlobAttachmentRichNode],
      content,
    });
  }

  describe("schema", () => {
    it("should register blobAttachment node type", () => {
      editor = createRichEditor();
      expect(editor.schema.nodes.blobAttachment).toBeDefined();
    });

    it("should be a block-level node", () => {
      editor = createRichEditor();
      const spec = editor.schema.nodes.blobAttachment.spec;
      expect(spec.group).toBe("block");
      expect(spec.inline).toBe(false);
    });

    it("should be an atom node", () => {
      editor = createRichEditor();
      expect(editor.schema.nodes.blobAttachment.spec.atom).toBe(true);
    });

    it("should have correct attributes", () => {
      editor = createRichEditor();
      const attrs = editor.schema.nodes.blobAttachment.spec.attrs!;
      expect(attrs).toHaveProperty("url");
      expect(attrs).toHaveProperty("sha256");
      expect(attrs).toHaveProperty("mimeType");
      expect(attrs).toHaveProperty("size");
      expect(attrs).toHaveProperty("server");
    });
  });

  describe("renderText", () => {
    it("should return URL as text", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: SAMPLE_BLOB,
      });
      expect(editor.getText()).toContain(SAMPLE_BLOB.url);
    });

    it("should return empty string when url is null", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: { ...SAMPLE_BLOB, url: null },
      });
      expect(editor.getText().trim()).toBe("");
    });
  });

  describe("node attributes", () => {
    it("should store all attributes on inserted node", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: SAMPLE_BLOB,
      });

      let blobNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "blobAttachment") {
          blobNode = node;
          return false;
        }
      });

      expect(blobNode).not.toBeNull();
      expect(blobNode.attrs.url).toBe(SAMPLE_BLOB.url);
      expect(blobNode.attrs.sha256).toBe(SAMPLE_BLOB.sha256);
      expect(blobNode.attrs.mimeType).toBe(SAMPLE_BLOB.mimeType);
      expect(blobNode.attrs.size).toBe(SAMPLE_BLOB.size);
      expect(blobNode.attrs.server).toBe(SAMPLE_BLOB.server);
    });
  });

  describe("parseHTML", () => {
    it("should parse div with data-blob-attachment attribute", () => {
      editor = createRichEditor();
      const parseRules = editor.schema.nodes.blobAttachment.spec.parseDOM;
      expect(parseRules).toBeDefined();
      expect(parseRules![0].tag).toBe('div[data-blob-attachment="true"]');
    });
  });
});

describe("BlobAttachmentInlineNode", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  function createInlineEditor(content?: string) {
    return new Editor({
      extensions: [StarterKit, BlobAttachmentInlineNode],
      content,
    });
  }

  describe("schema", () => {
    it("should be an inline node", () => {
      editor = createInlineEditor();
      const spec = editor.schema.nodes.blobAttachment.spec;
      expect(spec.group).toBe("inline");
      expect(spec.inline).toBe(true);
    });

    it("should be an atom node", () => {
      editor = createInlineEditor();
      expect(editor.schema.nodes.blobAttachment.spec.atom).toBe(true);
    });
  });

  describe("renderText", () => {
    it("should return URL as text", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "blobAttachment",
        attrs: SAMPLE_BLOB,
      });
      expect(editor.getText()).toContain(SAMPLE_BLOB.url);
    });
  });

  describe("parseHTML", () => {
    it("should parse span with data-blob-attachment attribute", () => {
      editor = createInlineEditor();
      const parseRules = editor.schema.nodes.blobAttachment.spec.parseDOM;
      expect(parseRules![0].tag).toBe('span[data-blob-attachment="true"]');
    });
  });
});
