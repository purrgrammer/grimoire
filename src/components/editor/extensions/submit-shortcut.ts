import { Extension } from "@tiptap/core";
import type { MutableRefObject } from "react";
import type { Editor } from "@tiptap/core";

interface SubmitShortcutOptions {
  /** Ref to the submit handler (uses ref to avoid stale closures) */
  submitRef: MutableRefObject<(editor: Editor) => void>;
  /** If true, plain Enter submits (desktop chat). If false, Enter creates newline (rich editor / mobile). */
  enterSubmits: boolean;
}

/**
 * Keyboard shortcut extension for editor submission
 *
 * - Ctrl/Cmd+Enter always submits
 * - Plain Enter behavior depends on `enterSubmits` option:
 *   - true (desktop chat): Enter submits, Shift+Enter inserts newline
 *   - false (rich editor / mobile): Enter creates newline normally
 */
export const SubmitShortcut = Extension.create<SubmitShortcutOptions>({
  name: "submitShortcut",

  addOptions() {
    return {
      submitRef: { current: () => {} } as MutableRefObject<
        (editor: Editor) => void
      >,
      enterSubmits: false,
    };
  },

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {
      "Mod-Enter": () => {
        this.options.submitRef.current(this.editor);
        return true;
      },
    };

    if (this.options.enterSubmits) {
      shortcuts["Enter"] = () => {
        this.options.submitRef.current(this.editor);
        return true;
      };
    }

    return shortcuts;
  },
});
