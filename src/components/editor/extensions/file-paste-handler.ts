import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * File paste handler extension to intercept file pastes and trigger upload
 *
 * Handles clipboard paste events with files (e.g., pasting images from clipboard)
 * and triggers a callback to open the upload dialog.
 */
export const FilePasteHandler = Extension.create<{
  onFilePaste?: (files: File[]) => void;
}>({
  name: "filePasteHandler",

  addOptions() {
    return {
      onFilePaste: undefined,
    };
  },

  addProseMirrorPlugins() {
    const onFilePaste = this.options.onFilePaste;

    return [
      new Plugin({
        key: new PluginKey("filePasteHandler"),

        props: {
          handlePaste: (_view, event) => {
            // Handle paste events with files (e.g., pasting images from clipboard)
            const files = event.clipboardData?.files;
            if (!files || files.length === 0) return false;

            // Check if files are images, videos, or audio
            const validFiles = Array.from(files).filter((file) =>
              file.type.match(/^(image|video|audio)\//),
            );

            if (validFiles.length === 0) return false;

            // Trigger the file paste callback
            if (onFilePaste) {
              onFilePaste(validFiles);
              event.preventDefault();
              return true; // Prevent default paste behavior
            }

            return false;
          },
        },
      }),
    ];
  },
});
