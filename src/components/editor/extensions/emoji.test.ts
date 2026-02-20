// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

// Mock React node views (not needed for headless tests)
vi.mock("@tiptap/react", () => ({
  ReactNodeViewRenderer: () => () => null,
}));
vi.mock("../node-views/EmojiNodeView", () => ({ EmojiNodeView: {} }));

import { EmojiMention } from "./emoji";

// ProseMirror requires layout APIs that jsdom lacks
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

function createEditor(content?: string) {
  return new Editor({
    extensions: [
      StarterKit,
      EmojiMention.configure({
        suggestion: { char: ":" },
      }),
    ],
    content,
  });
}

describe("EmojiMention", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  describe("schema", () => {
    it("should register emoji node type", () => {
      editor = createEditor();
      expect(editor.schema.nodes.emoji).toBeDefined();
    });

    it("should have url attribute", () => {
      editor = createEditor();
      expect(editor.schema.nodes.emoji.spec.attrs).toHaveProperty("url");
    });

    it("should have source attribute", () => {
      editor = createEditor();
      expect(editor.schema.nodes.emoji.spec.attrs).toHaveProperty("source");
    });

    it("should inherit mention attributes (id, label)", () => {
      editor = createEditor();
      const attrs = editor.schema.nodes.emoji.spec.attrs!;
      expect(attrs).toHaveProperty("id");
      expect(attrs).toHaveProperty("label");
    });
  });

  describe("renderText", () => {
    it("should return emoji character for unicode source", () => {
      editor = createEditor();
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "fire",
          label: "fire",
          url: "🔥",
          source: "unicode",
          mentionSuggestionChar: ":",
        },
      });
      expect(editor.getText()).toContain("🔥");
    });

    it("should return :shortcode: for custom emoji", () => {
      editor = createEditor();
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "pepe",
          label: "pepe",
          url: "https://cdn.example.com/pepe.png",
          source: "custom",
          mentionSuggestionChar: ":",
        },
      });
      expect(editor.getText()).toContain(":pepe:");
    });

    it("should return empty string for unicode with no url", () => {
      editor = createEditor();
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "unknown",
          label: "unknown",
          url: null,
          source: "unicode",
          mentionSuggestionChar: ":",
        },
      });
      expect(editor.getText()).not.toContain(":unknown:");
      expect(editor.getText().trim()).toBe("");
    });

    it("should handle multiple emoji in sequence", () => {
      editor = createEditor();
      editor
        .chain()
        .insertContent([
          {
            type: "emoji",
            attrs: {
              id: "fire",
              url: "🔥",
              source: "unicode",
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
        ])
        .run();

      const text = editor.getText();
      expect(text).toContain("🔥");
      expect(text).toContain(":pepe:");
    });
  });

  describe("mentionSuggestionChar", () => {
    it("should preserve mentionSuggestionChar when explicitly set to ':'", () => {
      editor = createEditor();
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "fire",
          label: "fire",
          url: "🔥",
          source: "unicode",
          mentionSuggestionChar: ":",
        },
      });

      let emojiNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "emoji") {
          emojiNode = node;
          return false;
        }
      });

      expect(emojiNode).not.toBeNull();
      expect(emojiNode.attrs.mentionSuggestionChar).toBe(":");
    });

    it("should default mentionSuggestionChar to '@' if not explicitly set", () => {
      editor = createEditor();
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "fire",
          label: "fire",
          url: "🔥",
          source: "unicode",
          // NOT setting mentionSuggestionChar - tests the regression
        },
      });

      let emojiNode: any = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "emoji") {
          emojiNode = node;
          return false;
        }
      });

      // Mention extension defaults to "@" - this is why we must always
      // set mentionSuggestionChar: ":" when inserting emoji nodes
      expect(emojiNode?.attrs.mentionSuggestionChar).toBe("@");
    });
  });

  describe("backspace behavior", () => {
    it("should replace emoji with ':' when backspacing (mentionSuggestionChar set)", () => {
      editor = createEditor("<p>hello </p>");
      // Move to end
      editor.commands.focus("end");
      // Insert emoji with correct mentionSuggestionChar
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "fire",
          label: "fire",
          url: "🔥",
          source: "unicode",
          mentionSuggestionChar: ":",
        },
      });

      // Verify emoji is present
      expect(editor.getText()).toContain("🔥");

      // Simulate backspace - Mention extension handles this
      editor.commands.keyboardShortcut("Backspace");

      // After backspace, emoji should be replaced by ":"
      const text = editor.getText();
      expect(text).not.toContain("🔥");
      expect(text).toContain(":");
      expect(text).not.toContain("@");
    });

    it("should replace emoji with '@' when mentionSuggestionChar was not set (regression)", () => {
      editor = createEditor("<p>hello </p>");
      editor.commands.focus("end");
      editor.commands.insertContent({
        type: "emoji",
        attrs: {
          id: "fire",
          label: "fire",
          url: "🔥",
          source: "unicode",
          // NOT setting mentionSuggestionChar - demonstrates the regression
        },
      });

      editor.commands.keyboardShortcut("Backspace");

      // Without the fix, this would be "@" instead of ":"
      const text = editor.getText();
      expect(text).toContain("@");
    });
  });
});
