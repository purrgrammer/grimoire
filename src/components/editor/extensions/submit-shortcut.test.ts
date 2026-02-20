// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SubmitShortcut } from "./submit-shortcut";

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

describe("SubmitShortcut", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  describe("Mod-Enter (always submits)", () => {
    it("should call submit handler on Mod-Enter", () => {
      const submitFn = vi.fn();
      const submitRef = { current: submitFn };

      editor = new Editor({
        extensions: [
          StarterKit,
          SubmitShortcut.configure({
            submitRef,
            enterSubmits: false,
          }),
        ],
        content: "<p>Hello</p>",
      });

      editor.commands.keyboardShortcut("Mod-Enter");
      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(submitFn).toHaveBeenCalledWith(editor);
    });

    it("should call submit handler on Mod-Enter even when enterSubmits is true", () => {
      const submitFn = vi.fn();
      const submitRef = { current: submitFn };

      editor = new Editor({
        extensions: [
          StarterKit,
          SubmitShortcut.configure({
            submitRef,
            enterSubmits: true,
          }),
        ],
        content: "<p>Hello</p>",
      });

      editor.commands.keyboardShortcut("Mod-Enter");
      expect(submitFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("Enter behavior with enterSubmits: true", () => {
    it("should call submit handler on Enter", () => {
      const submitFn = vi.fn();
      const submitRef = { current: submitFn };

      editor = new Editor({
        extensions: [
          StarterKit,
          SubmitShortcut.configure({
            submitRef,
            enterSubmits: true,
          }),
        ],
        content: "<p>Hello</p>",
      });

      editor.commands.keyboardShortcut("Enter");
      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(submitFn).toHaveBeenCalledWith(editor);
    });
  });

  describe("Enter behavior with enterSubmits: false", () => {
    it("should NOT call submit handler on Enter", () => {
      const submitFn = vi.fn();
      const submitRef = { current: submitFn };

      editor = new Editor({
        extensions: [
          StarterKit,
          SubmitShortcut.configure({
            submitRef,
            enterSubmits: false,
          }),
        ],
        content: "<p>Hello</p>",
      });

      editor.commands.keyboardShortcut("Enter");
      expect(submitFn).not.toHaveBeenCalled();
    });
  });

  describe("ref update", () => {
    it("should use the ref value that was current at configure time", () => {
      const submitFn = vi.fn();
      const submitRef = { current: submitFn };

      editor = new Editor({
        extensions: [
          StarterKit,
          SubmitShortcut.configure({
            submitRef,
            enterSubmits: false,
          }),
        ],
        content: "<p>Hello</p>",
      });

      // Trigger shortcut - should call the function from configure time
      editor.commands.keyboardShortcut("Mod-Enter");
      expect(submitFn).toHaveBeenCalledTimes(1);
    });
  });
});
