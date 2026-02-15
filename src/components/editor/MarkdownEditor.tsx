import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import type { SuggestionOptions } from "@tiptap/suggestion";
import tippy from "tippy.js";
import type { Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import {
  ProfileSuggestionList,
  type ProfileSuggestionListHandle,
} from "./ProfileSuggestionList";
import {
  EmojiSuggestionList,
  type EmojiSuggestionListHandle,
} from "./EmojiSuggestionList";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";
import { nip19 } from "nostr-tools";
import { NostrPasteHandler } from "./extensions/nostr-paste-handler";
import { FilePasteHandler } from "./extensions/file-paste-handler";
import { BlobAttachmentRichNode } from "./extensions/blob-attachment-rich";
import { NostrEventPreviewRichNode } from "./extensions/nostr-event-preview-rich";
import type { BlobAttachment, SerializedContent } from "./MentionEditor";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { MarkdownContent } from "@/components/nostr/MarkdownContent";
import { serializeEditorToMarkdown } from "@/lib/markdown-serializer";

export interface MarkdownEditorProps {
  placeholder?: string;
  onSubmit?: (markdown: string, serialized: SerializedContent) => void;
  onChange?: () => void;
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  onFilePaste?: (files: File[]) => void;
  autoFocus?: boolean;
  className?: string;
  /** Minimum editor height in pixels */
  minHeight?: number;
  /** Maximum editor height in pixels */
  maxHeight?: number;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  clear: () => void;
  /** Get the content serialized as a markdown string */
  getMarkdown: () => string;
  /** Get full serialized content with emoji tags, blob attachments, etc. */
  getSerializedContent: () => SerializedContent;
  isEmpty: () => boolean;
  submit: () => void;
  /** Insert text at the current cursor position */
  insertText: (text: string) => void;
  /** Insert a blob attachment with rich preview */
  insertBlob: (blob: BlobAttachment) => void;
  /** Get editor state as JSON (for persistence/drafts) */
  getJSON: () => any;
  /** Restore editor content from JSON */
  setContent: (json: any) => void;
}

// Create emoji extension by extending Mention with a different name and custom node view
const EmojiMention = Mention.extend({
  name: "emoji",

  addAttributes() {
    return {
      ...this.parent?.(),
      url: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-url"),
        renderHTML: (attributes) => {
          if (!attributes.url) return {};
          return { "data-url": attributes.url };
        },
      },
      source: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source"),
        renderHTML: (attributes) => {
          if (!attributes.source) return {};
          return { "data-source": attributes.source };
        },
      },
    };
  },

  renderText({ node }) {
    if (node.attrs.source === "unicode") {
      return node.attrs.url || "";
    }
    return `:${node.attrs.id}:`;
  },

  addNodeView() {
    return ({ node }) => {
      const { url, source, id } = node.attrs;
      const isUnicode = source === "unicode";

      const dom = document.createElement("span");
      dom.className = "emoji-node";
      dom.setAttribute("data-emoji", id || "");

      if (isUnicode && url) {
        const span = document.createElement("span");
        span.className = "emoji-unicode";
        span.textContent = url;
        span.title = `:${id}:`;
        dom.appendChild(span);
      } else if (url) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = `:${id}:`;
        img.title = `:${id}:`;
        img.className = "emoji-image";
        img.draggable = false;
        img.onerror = () => {
          dom.textContent = `:${id}:`;
        };
        dom.appendChild(img);
      } else {
        dom.textContent = `:${id}:`;
      }

      return { dom };
    };
  },
});

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(
  (
    {
      placeholder = "Write markdown...",
      onSubmit,
      onChange,
      searchProfiles,
      searchEmojis,
      onFilePaste,
      autoFocus = false,
      className = "",
      minHeight = 200,
      maxHeight = 600,
    },
    ref,
  ) => {
    const [preview, setPreview] = useState(false);
    const [previewContent, setPreviewContent] = useState("");
    const handleSubmitRef = useRef<(editor: any) => void>(() => {});

    // Create mention suggestion configuration
    const mentionSuggestion: Omit<SuggestionOptions, "editor"> = useMemo(
      () => ({
        char: "@",
        allowSpaces: false,
        items: async ({ query }) => {
          return await searchProfiles(query);
        },
        render: () => {
          let component: ReactRenderer<ProfileSuggestionListHandle>;
          let popup: TippyInstance[];

          return {
            onStart: (props) => {
              component = new ReactRenderer(ProfileSuggestionList, {
                props: { items: [], command: props.command },
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                theme: "mention",
              });
            },

            onUpdate(props) {
              component.updateProps({
                items: props.items,
                command: props.command,
              });
              if (!props.clientRect) return;
              popup[0].setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onKeyDown(props) {
              if (props.event.key === "Escape") {
                popup[0].hide();
                return true;
              }
              return component.ref?.onKeyDown(props.event) || false;
            },

            onExit() {
              popup[0].destroy();
              component.destroy();
            },
          };
        },
      }),
      [searchProfiles],
    );

    // Create emoji suggestion configuration
    const emojiSuggestion: Omit<SuggestionOptions, "editor"> | undefined =
      useMemo(() => {
        if (!searchEmojis) return undefined;

        return {
          char: ":",
          allowSpaces: false,
          items: async ({ query }) => {
            return await searchEmojis(query);
          },
          render: () => {
            let component: ReactRenderer<EmojiSuggestionListHandle>;
            let popup: TippyInstance[];

            return {
              onStart: (props) => {
                component = new ReactRenderer(EmojiSuggestionList, {
                  props: { items: [], command: props.command },
                  editor: props.editor,
                });

                if (!props.clientRect) return;

                popup = tippy("body", {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: "manual",
                  placement: "bottom-start",
                  theme: "mention",
                });
              },

              onUpdate(props) {
                component.updateProps({
                  items: props.items,
                  command: props.command,
                });
                if (!props.clientRect) return;
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                });
              },

              onKeyDown(props) {
                if (props.event.key === "Escape") {
                  popup[0].hide();
                  return true;
                }
                return component.ref?.onKeyDown(props.event) || false;
              },

              onExit() {
                popup[0].destroy();
                component.destroy();
              },
            };
          },
        };
      }, [searchEmojis]);

    // Handle submit
    const handleSubmit = useCallback(
      (editorInstance: any) => {
        if (editorInstance.isEmpty) return;

        const serialized = serializeEditorToMarkdown(editorInstance);

        if (onSubmit) {
          onSubmit(serialized.text, serialized);
        }
      },
      [onSubmit],
    );

    handleSubmitRef.current = handleSubmit;

    // Build extensions
    const extensions = useMemo(() => {
      const SubmitShortcut = Extension.create({
        name: "submitShortcut",
        addKeyboardShortcuts() {
          return {
            "Mod-Enter": ({ editor }) => {
              handleSubmitRef.current(editor);
              return true;
            },
          };
        },
      });

      const exts = [
        SubmitShortcut,
        StarterKit.configure({
          hardBreak: { keepMarks: false },
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: "text-accent underline decoration-dotted cursor-pointer",
          },
        }),
        Mention.extend({
          renderText({ node }) {
            try {
              return `nostr:${nip19.npubEncode(node.attrs.id)}`;
            } catch {
              return `@${node.attrs.label}`;
            }
          },
        }).configure({
          HTMLAttributes: { class: "mention" },
          suggestion: {
            ...mentionSuggestion,
            command: ({ editor, range, props }: any) => {
              editor
                .chain()
                .focus()
                .insertContentAt(range, [
                  {
                    type: "mention",
                    attrs: {
                      id: props.pubkey,
                      label: props.displayName,
                    },
                  },
                  { type: "text", text: " " },
                ])
                .run();
            },
          },
          renderLabel({ node }) {
            return `@${node.attrs.label}`;
          },
        }),
        Placeholder.configure({ placeholder }),
        BlobAttachmentRichNode,
        NostrEventPreviewRichNode,
        NostrPasteHandler,
        FilePasteHandler.configure({ onFilePaste }),
      ];

      if (emojiSuggestion) {
        exts.push(
          EmojiMention.configure({
            HTMLAttributes: { class: "emoji" },
            suggestion: {
              ...emojiSuggestion,
              command: ({ editor, range, props }: any) => {
                editor
                  .chain()
                  .focus()
                  .insertContentAt(range, [
                    {
                      type: "emoji",
                      attrs: {
                        id: props.shortcode,
                        label: props.shortcode,
                        url: props.url,
                        source: props.source,
                      },
                    },
                    { type: "text", text: " " },
                  ])
                  .run();
              },
            },
          }),
        );
      }

      return exts;
    }, [mentionSuggestion, emojiSuggestion, onFilePaste, placeholder]);

    const editor = useEditor({
      extensions,
      editorProps: {
        attributes: {
          class: "prose prose-sm max-w-none focus:outline-none",
          style: `min-height: ${minHeight}px; max-height: ${maxHeight}px; overflow-y: auto; padding: 1rem;`,
        },
      },
      autofocus: autoFocus,
      onUpdate: () => {
        onChange?.();
      },
    });

    const isEditorReady = useCallback(() => {
      return editor && editor.view && editor.view.dom;
    }, [editor]);

    // Toggle preview mode
    const togglePreview = useCallback(() => {
      setPreview((prev) => {
        if (!prev && isEditorReady() && editor) {
          // Entering preview: capture current markdown
          const serialized = serializeEditorToMarkdown(editor);
          setPreviewContent(serialized.text);
        }
        return !prev;
      });
    }, [editor, isEditorReady]);

    // Expose editor methods
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (isEditorReady()) {
            editor?.commands.focus();
          }
        },
        clear: () => {
          if (isEditorReady()) {
            editor?.commands.clearContent();
          }
        },
        getMarkdown: () => {
          if (!isEditorReady() || !editor) return "";
          return serializeEditorToMarkdown(editor).text;
        },
        getSerializedContent: () => {
          if (!isEditorReady() || !editor)
            return {
              text: "",
              emojiTags: [],
              blobAttachments: [],
              addressRefs: [],
            };
          return serializeEditorToMarkdown(editor);
        },
        isEmpty: () => {
          if (!isEditorReady()) return true;
          return editor?.isEmpty ?? true;
        },
        submit: () => {
          if (isEditorReady() && editor) {
            handleSubmit(editor);
          }
        },
        insertText: (text: string) => {
          if (isEditorReady()) {
            editor?.commands.insertContent(text);
          }
        },
        insertBlob: (blob: BlobAttachment) => {
          if (isEditorReady()) {
            editor?.commands.insertContent({
              type: "blobAttachment",
              attrs: blob,
            });
          }
        },
        getJSON: () => {
          if (!isEditorReady()) return null;
          return editor?.getJSON() || null;
        },
        setContent: (json: any) => {
          if (isEditorReady() && json) {
            editor?.commands.setContent(json);
          }
        },
      }),
      [editor, handleSubmit, isEditorReady],
    );

    if (!editor) {
      return null;
    }

    return (
      <div
        className={`markdown-editor flex flex-col border border-border rounded overflow-hidden ${className}`}
      >
        <MarkdownToolbar
          editor={editor}
          preview={preview}
          onTogglePreview={togglePreview}
        />

        {preview ? (
          <div className="p-4 overflow-y-auto" style={{ minHeight, maxHeight }}>
            {previewContent ? (
              <MarkdownContent content={previewContent} />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Nothing to preview
              </p>
            )}
          </div>
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";
