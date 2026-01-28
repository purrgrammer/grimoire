/**
 * MarkdownEditor - TextEditor with markdown formatting toolbar
 *
 * Combines the TextEditor with a MarkdownToolbar for easy formatting.
 * Ideal for long-form content like articles, issues, wiki pages.
 */

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  TextEditor,
  type TextEditorProps,
  type TextEditorHandle,
} from "./TextEditor";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { MarkdownContent } from "@/components/nostr/MarkdownContent";
import type { Editor } from "@tiptap/react";

export interface MarkdownEditorProps extends TextEditorProps {
  /** Show preview toggle button in toolbar */
  enablePreview?: boolean;
  /** Initial preview state */
  initialPreview?: boolean;
}

export interface MarkdownEditorHandle extends TextEditorHandle {
  /** Toggle preview mode */
  togglePreview: () => void;
  /** Check if preview is active */
  isPreviewActive: () => boolean;
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(
  (
    { enablePreview = true, initialPreview = false, className = "", ...props },
    ref,
  ) => {
    const textEditorRef = useRef<TextEditorHandle>(null);
    const [showPreview, setShowPreview] = useState(initialPreview);
    const [editor, setEditor] = useState<Editor | null>(null);

    // Track when editor is available
    const handleEditorReady = useCallback(() => {
      const ed = textEditorRef.current?.getEditor();
      if (ed) {
        setEditor(ed);
      }
    }, []);

    // Toggle preview mode
    const togglePreview = useCallback(() => {
      setShowPreview((prev) => !prev);
    }, []);

    // Expose handle methods
    useImperativeHandle(
      ref,
      () => ({
        focus: () => textEditorRef.current?.focus(),
        clear: () => textEditorRef.current?.clear(),
        getContent: () => textEditorRef.current?.getContent() || "",
        getSerializedContent: () =>
          textEditorRef.current?.getSerializedContent() || {
            text: "",
            emojiTags: [],
            blobAttachments: [],
            addressRefs: [],
          },
        isEmpty: () => textEditorRef.current?.isEmpty() ?? true,
        submit: () => textEditorRef.current?.submit(),
        insertText: (text: string) => textEditorRef.current?.insertText(text),
        insertBlob: (blob) => textEditorRef.current?.insertBlob(blob),
        getJSON: () => textEditorRef.current?.getJSON(),
        setContent: (json) => textEditorRef.current?.setContent(json),
        getEditor: () => textEditorRef.current?.getEditor(),
        togglePreview,
        isPreviewActive: () => showPreview,
      }),
      [showPreview, togglePreview],
    );

    // Get content for preview
    const previewContent = showPreview
      ? textEditorRef.current?.getContent() || ""
      : "";

    return (
      <div className={`markdown-editor flex flex-col ${className}`}>
        <MarkdownToolbar
          editor={editor}
          showPreview={showPreview}
          onTogglePreview={enablePreview ? togglePreview : undefined}
          disabled={showPreview}
        />

        {showPreview ? (
          <div
            className="prose prose-sm max-w-none p-3 border border-border rounded bg-muted/30 overflow-y-auto"
            style={{
              minHeight: props.minHeight || 200,
              maxHeight: props.maxHeight || 600,
            }}
          >
            {previewContent ? (
              <MarkdownContent content={previewContent} />
            ) : (
              <p className="text-muted-foreground italic">Nothing to preview</p>
            )}
          </div>
        ) : (
          <TextEditor
            ref={(node) => {
              textEditorRef.current = node;
              // Get editor after mount
              setTimeout(handleEditorReady, 0);
            }}
            className="flex-1"
            {...props}
          />
        )}
      </div>
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";
