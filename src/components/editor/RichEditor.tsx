import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
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
import type {
  EmojiTag,
  BlobAttachment,
  SerializedContent,
} from "./MentionEditor";

export interface RichEditorProps {
  placeholder?: string;
  onSubmit?: (
    content: string,
    emojiTags: EmojiTag[],
    blobAttachments: BlobAttachment[],
    addressRefs: Array<{ kind: number; pubkey: string; identifier: string }>,
  ) => void;
  onChange?: () => void;
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  onFilePaste?: (files: File[]) => void;
  autoFocus?: boolean;
  className?: string;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Maximum height in pixels */
  maxHeight?: number;
}

export interface RichEditorHandle {
  focus: () => void;
  clear: () => void;
  getContent: () => string;
  getSerializedContent: () => SerializedContent;
  isEmpty: () => boolean;
  submit: () => void;
  /** Insert text at the current cursor position */
  insertText: (text: string) => void;
  /** Insert a blob attachment with rich preview */
  insertBlob: (blob: BlobAttachment) => void;
  /** Get editor state as JSON (for persistence) */
  getJSON: () => any;
  /** Set editor content from JSON (for restoration) */
  setContent: (json: any) => void;
}

// Create emoji extension by extending Mention with a different name and custom node view
const EmojiMention = Mention.extend({
  name: "emoji",

  // Add custom attributes for emoji (url and source)
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

  // Override renderText to return empty string (nodeView handles display)
  renderText({ node }) {
    // Return the emoji character for unicode, or empty for custom
    // This is what gets copied to clipboard
    if (node.attrs.source === "unicode") {
      return node.attrs.url || "";
    }
    return `:${node.attrs.id}:`;
  },

  addNodeView() {
    return ({ node }) => {
      const { url, source, id } = node.attrs;
      const isUnicode = source === "unicode";

      // Create wrapper span
      const dom = document.createElement("span");
      dom.className = "emoji-node";
      dom.setAttribute("data-emoji", id || "");

      if (isUnicode && url) {
        // Unicode emoji - render as text span
        const span = document.createElement("span");
        span.className = "emoji-unicode";
        span.textContent = url;
        span.title = `:${id}:`;
        dom.appendChild(span);
      } else if (url) {
        // Custom emoji - render as image
        const img = document.createElement("img");
        img.src = url;
        img.alt = `:${id}:`;
        img.title = `:${id}:`;
        img.className = "emoji-image";
        img.draggable = false;
        img.onerror = () => {
          // Fallback to shortcode if image fails to load
          dom.textContent = `:${id}:`;
        };
        dom.appendChild(img);
      } else {
        // Fallback if no url - show shortcode
        dom.textContent = `:${id}:`;
      }

      return {
        dom,
      };
    };
  },
});

/**
 * Serialize editor content to plain text with nostr: URIs
 * Note: hashtags, mentions, and event quotes are extracted automatically by applesauce's
 * NoteBlueprint from the text content, so we only need to extract what it doesn't handle:
 * - Custom emojis (for emoji tags)
 * - Blob attachments (for imeta tags)
 * - Address references (naddr - not yet supported by applesauce)
 */
function serializeContent(editor: any): SerializedContent {
  const emojiTags: EmojiTag[] = [];
  const blobAttachments: BlobAttachment[] = [];
  const addressRefs: Array<{
    kind: number;
    pubkey: string;
    identifier: string;
  }> = [];
  const seenEmojis = new Set<string>();
  const seenBlobs = new Set<string>();
  const seenAddrs = new Set<string>();

  // Get plain text representation with single newline between blocks
  // (TipTap's default is double newline which adds extra blank lines)
  const text = editor.getText({ blockSeparator: "\n" });

  // Walk the document to collect emoji, blob, and address reference data
  editor.state.doc.descendants((node: any) => {
    if (node.type.name === "emoji") {
      const { id, url, source } = node.attrs;
      // Only add custom emojis (not unicode) and avoid duplicates
      if (source !== "unicode" && !seenEmojis.has(id)) {
        seenEmojis.add(id);
        emojiTags.push({ shortcode: id, url });
      }
    } else if (node.type.name === "blobAttachment") {
      const { url, sha256, mimeType, size, server } = node.attrs;
      // Avoid duplicates
      if (!seenBlobs.has(sha256)) {
        seenBlobs.add(sha256);
        blobAttachments.push({ url, sha256, mimeType, size, server });
      }
    } else if (node.type.name === "nostrEventPreview") {
      // Extract address references (naddr) for manual a tags
      // Note: applesauce handles note/nevent automatically from nostr: URIs
      const { type, data } = node.attrs;
      if (type === "naddr" && data) {
        const addrKey = `${data.kind}:${data.pubkey}:${data.identifier || ""}`;
        if (!seenAddrs.has(addrKey)) {
          seenAddrs.add(addrKey);
          addressRefs.push({
            kind: data.kind,
            pubkey: data.pubkey,
            identifier: data.identifier || "",
          });
        }
      }
    }
  });

  return {
    text,
    emojiTags,
    blobAttachments,
    addressRefs,
  };
}

export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(
  (
    {
      placeholder = "Write your note...",
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
    // Ref to access handleSubmit from keyboard shortcuts
    const handleSubmitRef = useRef<(editor: any) => void>(() => {});

    // Create mention suggestion configuration for @ mentions
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

              if (!props.clientRect) {
                return;
              }

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

              if (!props.clientRect) {
                return;
              }

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

    // Create emoji suggestion configuration for : emojis
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

                if (!props.clientRect) {
                  return;
                }

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

                if (!props.clientRect) {
                  return;
                }

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
        if (editorInstance.isEmpty) {
          return;
        }

        const serialized = serializeContent(editorInstance);

        if (onSubmit) {
          onSubmit(
            serialized.text,
            serialized.emojiTags,
            serialized.blobAttachments,
            serialized.addressRefs,
          );
          // Don't clear content here - let the parent component decide when to clear
        }
      },
      [onSubmit],
    );

    // Keep ref updated with latest handleSubmit
    handleSubmitRef.current = handleSubmit;

    // Build extensions array
    const extensions = useMemo(() => {
      // Custom extension for keyboard shortcuts
      const SubmitShortcut = Extension.create({
        name: "submitShortcut",
        addKeyboardShortcuts() {
          return {
            // Ctrl/Cmd+Enter submits
            "Mod-Enter": ({ editor }) => {
              handleSubmitRef.current(editor);
              return true;
            },
            // Plain Enter creates a new line (default behavior)
          };
        },
      });

      const exts = [
        SubmitShortcut,
        StarterKit.configure({
          // Enable paragraph, hardBreak, etc. for multi-line
          hardBreak: {
            keepMarks: false,
          },
        }),
        Mention.extend({
          renderText({ node }) {
            // Serialize to nostr: URI for plain text export
            try {
              return `nostr:${nip19.npubEncode(node.attrs.id)}`;
            } catch (err) {
              console.error("[Mention] Failed to encode pubkey:", err);
              return `@${node.attrs.label}`;
            }
          },
        }).configure({
          HTMLAttributes: {
            class: "mention",
          },
          suggestion: {
            ...mentionSuggestion,
            command: ({ editor, range, props }: any) => {
              // props is the ProfileSearchResult
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
        Placeholder.configure({
          placeholder,
        }),
        // Add blob attachment extension for full-size media previews
        BlobAttachmentRichNode,
        // Add nostr event preview extension for full event rendering
        NostrEventPreviewRichNode,
        // Add paste handler to transform bech32 strings into previews
        NostrPasteHandler,
        // Add file paste handler for clipboard file uploads
        FilePasteHandler.configure({
          onFilePaste,
        }),
      ];

      // Add emoji extension if search is provided
      if (emojiSuggestion) {
        exts.push(
          EmojiMention.configure({
            HTMLAttributes: {
              class: "emoji",
            },
            suggestion: {
              ...emojiSuggestion,
              command: ({ editor, range, props }: any) => {
                // props is the EmojiSearchResult
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
          style: `min-height: ${minHeight}px; max-height: ${maxHeight}px; overflow-y: auto;`,
        },
      },
      autofocus: autoFocus,
      onUpdate: () => {
        onChange?.();
      },
    });

    // Expose editor methods
    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
        clear: () => editor?.commands.clearContent(),
        getContent: () => editor?.getText({ blockSeparator: "\n" }) || "",
        getSerializedContent: () => {
          if (!editor)
            return {
              text: "",
              emojiTags: [],
              blobAttachments: [],
              addressRefs: [],
            };
          return serializeContent(editor);
        },
        isEmpty: () => editor?.isEmpty ?? true,
        submit: () => {
          if (editor) {
            handleSubmit(editor);
          }
        },
        insertText: (text: string) => {
          editor?.commands.insertContent(text);
        },
        insertBlob: (blob: BlobAttachment) => {
          editor?.commands.insertContent({
            type: "blobAttachment",
            attrs: blob,
          });
        },
        getJSON: () => {
          return editor?.getJSON() || null;
        },
        setContent: (json: any) => {
          if (editor && json) {
            editor.commands.setContent(json);
          }
        },
      }),
      [editor, handleSubmit],
    );

    // Handle submit on Ctrl/Cmd+Enter
    useEffect(() => {
      if (!editor) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          handleSubmit(editor);
        }
      };

      editor.view.dom.addEventListener("keydown", handleKeyDown);
      return () => {
        editor.view.dom.removeEventListener("keydown", handleKeyDown);
      };
    }, [editor, handleSubmit]);

    if (!editor) {
      return null;
    }

    return (
      <div className={`rich-editor ${className}`}>
        <EditorContent editor={editor} />
      </div>
    );
  },
);

RichEditor.displayName = "RichEditor";
