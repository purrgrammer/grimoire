// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { nip19 } from "nostr-tools";

// Mock React node views
vi.mock("@tiptap/react", () => ({
  ReactNodeViewRenderer: () => () => null,
}));
vi.mock("../node-views/NostrEventPreviewRich", () => ({
  NostrEventPreviewRich: {},
}));
vi.mock("../node-views/NostrEventPreviewInline", () => ({
  NostrEventPreviewInline: {},
}));

import { NostrEventPreviewRichNode } from "./nostr-event-preview-rich";
import { NostrEventPreviewInlineNode } from "./nostr-event-preview-inline";

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
const TEST_EVENT_ID =
  "d7a9c9f8e7b6a5d4c3b2a1f0e9d8c7b6a5d4c3b2a1f0e9d8c7b6a5d4c3b2a1f0";
const TEST_PUBKEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

describe("NostrEventPreviewRichNode (block-level)", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  function createRichEditor() {
    return new Editor({
      extensions: [StarterKit, NostrEventPreviewRichNode],
    });
  }

  describe("schema", () => {
    it("should register nostrEventPreview node type", () => {
      editor = createRichEditor();
      expect(editor.schema.nodes.nostrEventPreview).toBeDefined();
    });

    it("should be a block-level atom node", () => {
      editor = createRichEditor();
      const spec = editor.schema.nodes.nostrEventPreview.spec;
      expect(spec.group).toBe("block");
      expect(spec.inline).toBe(false);
      expect(spec.atom).toBe(true);
    });

    it("should have type and data attributes", () => {
      editor = createRichEditor();
      const attrs = editor.schema.nodes.nostrEventPreview.spec.attrs!;
      expect(attrs).toHaveProperty("type");
      expect(attrs).toHaveProperty("data");
    });
  });

  describe("renderText", () => {
    it("should encode note type back to nostr: URI", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "note", data: TEST_EVENT_ID },
      });

      const text = editor.getText();
      const expectedNote = nip19.noteEncode(TEST_EVENT_ID);
      expect(text).toContain(`nostr:${expectedNote}`);
    });

    it("should encode nevent type back to nostr: URI", () => {
      editor = createRichEditor();
      const eventPointer = {
        id: TEST_EVENT_ID,
        relays: ["wss://relay.example.com"],
      };
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "nevent", data: eventPointer },
      });

      const text = editor.getText();
      const expectedNevent = nip19.neventEncode(eventPointer);
      expect(text).toContain(`nostr:${expectedNevent}`);
    });

    it("should encode naddr type back to nostr: URI", () => {
      editor = createRichEditor();
      const addrPointer = {
        kind: 30023,
        pubkey: TEST_PUBKEY,
        identifier: "my-article",
      };
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "naddr", data: addrPointer },
      });

      const text = editor.getText();
      const expectedNaddr = nip19.naddrEncode(addrPointer);
      expect(text).toContain(`nostr:${expectedNaddr}`);
    });

    it("should return empty string for unknown type", () => {
      editor = createRichEditor();
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "unknown", data: null },
      });
      expect(editor.getText().trim()).toBe("");
    });
  });

  describe("parseHTML", () => {
    it("should parse div with data-nostr-preview attribute", () => {
      editor = createRichEditor();
      const parseRules = editor.schema.nodes.nostrEventPreview.spec.parseDOM;
      expect(parseRules![0].tag).toBe('div[data-nostr-preview="true"]');
    });
  });
});

describe("NostrEventPreviewInlineNode", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  function createInlineEditor() {
    return new Editor({
      extensions: [StarterKit, NostrEventPreviewInlineNode],
    });
  }

  describe("schema", () => {
    it("should be an inline atom node", () => {
      editor = createInlineEditor();
      const spec = editor.schema.nodes.nostrEventPreview.spec;
      expect(spec.group).toBe("inline");
      expect(spec.inline).toBe(true);
      expect(spec.atom).toBe(true);
    });
  });

  describe("renderText", () => {
    it("should encode note back to nostr: URI", () => {
      editor = createInlineEditor();
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "note", data: TEST_EVENT_ID },
      });

      const expectedNote = nip19.noteEncode(TEST_EVENT_ID);
      expect(editor.getText()).toContain(`nostr:${expectedNote}`);
    });

    it("should encode nevent back to nostr: URI", () => {
      editor = createInlineEditor();
      const eventPointer = { id: TEST_EVENT_ID };
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "nevent", data: eventPointer },
      });

      const expectedNevent = nip19.neventEncode(eventPointer);
      expect(editor.getText()).toContain(`nostr:${expectedNevent}`);
    });

    it("should encode naddr back to nostr: URI", () => {
      editor = createInlineEditor();
      const addrPointer = {
        kind: 30023,
        pubkey: TEST_PUBKEY,
        identifier: "test",
      };
      editor.commands.insertContent({
        type: "nostrEventPreview",
        attrs: { type: "naddr", data: addrPointer },
      });

      const expectedNaddr = nip19.naddrEncode(addrPointer);
      expect(editor.getText()).toContain(`nostr:${expectedNaddr}`);
    });
  });

  describe("parseHTML", () => {
    it("should parse span with data-nostr-preview attribute", () => {
      editor = createInlineEditor();
      const parseRules = editor.schema.nodes.nostrEventPreview.spec.parseDOM;
      expect(parseRules![0].tag).toBe('span[data-nostr-preview="true"]');
    });
  });
});
