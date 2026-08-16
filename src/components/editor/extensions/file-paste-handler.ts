import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * File paste and DROP handler: intercept files arriving at the composer and
 * hand them to the upload flow.
 *
 * Paste and drop are the same gesture as far as this is concerned — a file the
 * reader wants attached — so they share one callback and one filter. Drop
 * needed saying out loud because the browser's default is to NAVIGATE to the
 * dropped file, which throws away whatever was being written.
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

    /** Images, video and audio only — the kinds the timeline can render back. */
    const attachable = (list: FileList | undefined | null): File[] =>
      Array.from(list ?? []).filter((file) =>
        file.type.match(/^(image|video|audio)\//),
      );

    return [
      new Plugin({
        key: new PluginKey("filePasteHandler"),

        props: {
          handleDrop: (_view, event) => {
            if (!onFilePaste) return false;
            const files = attachable(
              (event as DragEvent).dataTransfer?.files ?? null,
            );
            if (files.length === 0) return false;
            onFilePaste(files);
            // Without this the browser leaves the app and opens the file.
            event.preventDefault();
            return true;
          },

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
