// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { FilePasteHandler } from "./file-paste-handler";

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

/**
 * Find the filePasteHandler plugin and extract its handlePaste function.
 * ProseMirror's PluginKey auto-increments keys (filePasteHandler$, filePasteHandler$1, etc.)
 * so we match by prefix. Cast to remove `this` context requirement.
 */
function getPasteHandler(editor: Editor) {
  const plugin = editor.state.plugins.find((p) =>
    (p as any).key?.startsWith("filePasteHandler$"),
  );
  return plugin?.props?.handlePaste as
    | ((view: any, event: any, slice: any) => boolean | void)
    | undefined;
}

/** Create a mock ClipboardEvent with files */
function mockPasteEvent(
  files: Array<{ name: string; type: string }>,
): ClipboardEvent {
  const fileList = files.map(
    (f) => new File(["content"], f.name, { type: f.type }),
  );

  return {
    clipboardData: {
      files: fileList,
      getData: () => "",
    },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
}

describe("FilePasteHandler", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  describe("image files", () => {
    it("should call onFilePaste with image files", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent([{ name: "photo.png", type: "image/png" }]);

      const handled = handlePaste!(editor.view, event, null as any);

      expect(handled).toBe(true);
      expect(onFilePaste).toHaveBeenCalledTimes(1);
      expect(onFilePaste.mock.calls[0][0]).toHaveLength(1);
      expect(onFilePaste.mock.calls[0][0][0].name).toBe("photo.png");
    });

    it("should handle multiple image types", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent([
        { name: "photo.jpg", type: "image/jpeg" },
        { name: "graphic.webp", type: "image/webp" },
        { name: "icon.gif", type: "image/gif" },
      ]);

      handlePaste!(editor.view, event, null as any);

      expect(onFilePaste).toHaveBeenCalledTimes(1);
      expect(onFilePaste.mock.calls[0][0]).toHaveLength(3);
    });
  });

  describe("video files", () => {
    it("should call onFilePaste with video files", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent([{ name: "clip.mp4", type: "video/mp4" }]);

      const handled = handlePaste!(editor.view, event, null as any);

      expect(handled).toBe(true);
      expect(onFilePaste).toHaveBeenCalledTimes(1);
      expect(onFilePaste.mock.calls[0][0][0].type).toBe("video/mp4");
    });
  });

  describe("audio files", () => {
    it("should call onFilePaste with audio files", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent([{ name: "song.mp3", type: "audio/mpeg" }]);

      const handled = handlePaste!(editor.view, event, null as any);

      expect(handled).toBe(true);
      expect(onFilePaste).toHaveBeenCalledTimes(1);
    });
  });

  describe("non-media files", () => {
    it("should ignore non-media files", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent([
        { name: "document.pdf", type: "application/pdf" },
        { name: "data.json", type: "application/json" },
      ]);

      const handled = handlePaste!(editor.view, event, null as any);

      expect(handled).toBe(false);
      expect(onFilePaste).not.toHaveBeenCalled();
    });

    it("should filter out non-media files from mixed paste", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent([
        { name: "photo.png", type: "image/png" },
        { name: "readme.txt", type: "text/plain" },
        { name: "clip.mp4", type: "video/mp4" },
      ]);

      handlePaste!(editor.view, event, null as any);

      expect(onFilePaste).toHaveBeenCalledTimes(1);
      // Should only receive the image and video, not the text file
      const files = onFilePaste.mock.calls[0][0];
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe("photo.png");
      expect(files[1].name).toBe("clip.mp4");
    });
  });

  describe("no files", () => {
    it("should return false when no files in clipboard", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = {
        clipboardData: { files: [], getData: () => "" },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;

      const handled = handlePaste!(editor.view, event, null as any);

      expect(handled).toBe(false);
      expect(onFilePaste).not.toHaveBeenCalled();
    });

    it("should return false when clipboardData is null", () => {
      const onFilePaste = vi.fn();
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({ onFilePaste })],
      });

      const handlePaste = getPasteHandler(editor);
      const event = {
        clipboardData: null,
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;

      const handled = handlePaste!(editor.view, event, null as any);

      expect(handled).toBe(false);
    });
  });

  describe("no callback", () => {
    it("should return false when onFilePaste is not configured", () => {
      editor = new Editor({
        extensions: [StarterKit, FilePasteHandler.configure({})],
      });

      const handlePaste = getPasteHandler(editor);
      const event = mockPasteEvent([{ name: "photo.png", type: "image/png" }]);

      const handled = handlePaste!(editor.view, event, null as any);
      expect(handled).toBe(false);
    });
  });
});
