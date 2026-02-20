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
vi.mock("../node-views/NostrEventPreviewRich", () => ({
  NostrEventPreviewRich: {},
}));

// Mock profile search service
vi.mock("@/services/profile-search", () => ({
  default: {
    getByPubkey: () => null,
  },
}));

import { NostrPasteHandler } from "./nostr-paste-handler";
import { NostrEventPreviewRichNode } from "./nostr-event-preview-rich";

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
const TEST_NPUB = nip19.npubEncode(TEST_PUBKEY);
const TEST_NOTE = nip19.noteEncode(TEST_EVENT_ID);
const TEST_NPROFILE = nip19.nprofileEncode({ pubkey: TEST_PUBKEY });
const TEST_NEVENT = nip19.neventEncode({ id: TEST_EVENT_ID });
const TEST_NADDR = nip19.naddrEncode({
  kind: 30023,
  pubkey: TEST_PUBKEY,
  identifier: "test-article",
});

function createEditor() {
  return new Editor({
    extensions: [
      StarterKit,
      Mention.configure({ suggestion: { char: "@" } }),
      NostrEventPreviewRichNode,
      NostrPasteHandler,
    ],
  });
}

/**
 * Find the nostrPasteHandler plugin and extract its handlePaste function.
 * ProseMirror's PluginKey auto-increments keys (nostrPasteHandler$, nostrPasteHandler$1, etc.)
 * so we match by prefix. Cast to remove `this` context requirement.
 */
function getPasteHandler(editor: Editor) {
  const plugin = editor.state.plugins.find((p) =>
    (p as any).key?.startsWith("nostrPasteHandler$"),
  );
  return plugin?.props?.handlePaste as
    | ((view: any, event: any, slice: any) => boolean | void)
    | undefined;
}

/** Create a mock ClipboardEvent with text */
function mockPasteEvent(text: string): ClipboardEvent {
  return {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      files: [],
    },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
}

describe("NostrPasteHandler", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  describe("bech32 regex matching", () => {
    it("should detect npub with nostr: prefix", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent(`nostr:${TEST_NPUB}`);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(true);
    });

    it("should detect bare npub without nostr: prefix", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent(TEST_NPUB);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(true);
    });

    it("should detect note", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent(TEST_NOTE);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(true);
    });

    it("should detect nprofile", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent(TEST_NPROFILE);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(true);
    });

    it("should detect nevent", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent(TEST_NEVENT);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(true);
    });

    it("should detect naddr", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent(TEST_NADDR);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(true);
    });

    it("should NOT match bech32 inside URLs", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      // bech32 inside a URL should not be matched (no whitespace boundary)
      const event = mockPasteEvent(`https://njump.me/${TEST_NPUB}`);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(false);
    });

    it("should pass through plain text without bech32", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent("just some regular text");

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(false);
    });

    it("should pass through empty clipboard", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent("");

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(false);
    });
  });

  describe("node creation", () => {
    it("should create mention node for npub", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(editor.view, mockPasteEvent(TEST_NPUB), null as any);

      let mentionNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "mention") {
          mentionNode = node;
          return false;
        }
      });

      expect(mentionNode).not.toBeNull();
      expect(mentionNode.attrs.id).toBe(TEST_PUBKEY);
    });

    it("should create mention node for nprofile", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(editor.view, mockPasteEvent(TEST_NPROFILE), null as any);

      let mentionNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "mention") {
          mentionNode = node;
          return false;
        }
      });

      expect(mentionNode).not.toBeNull();
      expect(mentionNode.attrs.id).toBe(TEST_PUBKEY);
    });

    it("should create nostrEventPreview node for note", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(editor.view, mockPasteEvent(TEST_NOTE), null as any);

      let previewNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "nostrEventPreview") {
          previewNode = node;
          return false;
        }
      });

      expect(previewNode).not.toBeNull();
      expect(previewNode.attrs.type).toBe("note");
      expect(previewNode.attrs.data).toBe(TEST_EVENT_ID);
    });

    it("should create nostrEventPreview node for nevent", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(editor.view, mockPasteEvent(TEST_NEVENT), null as any);

      let previewNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "nostrEventPreview") {
          previewNode = node;
          return false;
        }
      });

      expect(previewNode).not.toBeNull();
      expect(previewNode.attrs.type).toBe("nevent");
      expect(previewNode.attrs.data).toHaveProperty("id", TEST_EVENT_ID);
    });

    it("should create nostrEventPreview node for naddr", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(editor.view, mockPasteEvent(TEST_NADDR), null as any);

      let previewNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "nostrEventPreview") {
          previewNode = node;
          return false;
        }
      });

      expect(previewNode).not.toBeNull();
      expect(previewNode.attrs.type).toBe("naddr");
      expect(previewNode.attrs.data).toHaveProperty("kind", 30023);
      expect(previewNode.attrs.data).toHaveProperty("pubkey", TEST_PUBKEY);
      expect(previewNode.attrs.data).toHaveProperty(
        "identifier",
        "test-article",
      );
    });
  });

  describe("surrounding text preservation", () => {
    it("should preserve text before bech32", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(
        editor.view,
        mockPasteEvent(`check this out ${TEST_NOTE}`),
        null as any,
      );

      // The editor should contain both text and the preview node
      let hasText = false;
      let hasPreview = false;
      editor.state.doc.descendants((node) => {
        if (node.isText && node.text?.includes("check this out")) {
          hasText = true;
        }
        if (node.type.name === "nostrEventPreview") {
          hasPreview = true;
        }
      });

      expect(hasText).toBe(true);
      expect(hasPreview).toBe(true);
    });

    it("should preserve text after bech32", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(
        editor.view,
        mockPasteEvent(`${TEST_NOTE} is really cool`),
        null as any,
      );

      let hasText = false;
      let hasPreview = false;
      editor.state.doc.descendants((node) => {
        if (node.isText && node.text?.includes("is really cool")) {
          hasText = true;
        }
        if (node.type.name === "nostrEventPreview") {
          hasPreview = true;
        }
      });

      expect(hasText).toBe(true);
      expect(hasPreview).toBe(true);
    });

    it("should handle multiple bech32 entities in one paste", () => {
      editor = createEditor();
      const handlePaste = getPasteHandler(editor);
      handlePaste!(
        editor.view,
        mockPasteEvent(`${TEST_NPUB} shared ${TEST_NOTE}`),
        null as any,
      );

      let mentionCount = 0;
      let previewCount = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "mention") mentionCount++;
        if (node.type.name === "nostrEventPreview") previewCount++;
      });

      expect(mentionCount).toBe(1);
      expect(previewCount).toBe(1);
    });
  });
});
