import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import {
  Extension,
  Node,
  mergeAttributes,
  type AnyExtension,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import tippy from "tippy.js";
import type { Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import { nip19 } from "nostr-tools";
import { cn } from "@/lib/utils";
import type {
  NostrEditorHandle,
  SerializedContent,
  BlobAttachment,
  EmojiTag,
  SuggestionConfig,
  SubmitBehavior,
  EditorVariant,
  BlobPreviewStyle,
  SuggestionListHandle,
} from "./types";

// Re-export handle type for consumers
export type { NostrEditorHandle };

export interface NostrEditorProps {
  /** Placeholder text when editor is empty */
  placeholder?: string;
  /** Initial content (plain text or TipTap JSON) */
  initialContent?: string | object;
  /** Called when content is submitted */
  onSubmit?: (content: SerializedContent) => void;
  /** Called when content changes */
  onChange?: (content: SerializedContent) => void;
  /** Called when editor is ready (mounted and initialized) */
  onReady?: () => void;
  /** Submit behavior: 'enter' (chat), 'ctrl-enter' (post), 'button-only' (external button) */
  submitBehavior?: SubmitBehavior;
  /** Layout variant: 'inline' (chat), 'multiline' (auto-expand), 'full' (fixed height) */
  variant?: EditorVariant;
  /** Minimum lines for multiline/full variants */
  minLines?: number;
  /** Maximum lines for multiline variant (auto-expand limit) */
  maxLines?: number;
  /** Blob preview style: 'compact' (pill), 'card' (thumbnail), 'gallery' (full-width) */
  blobPreview?: BlobPreviewStyle;
  /** Suggestion configurations */
  suggestions?: SuggestionConfig[];
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Additional CSS classes */
  className?: string;
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

function formatBlobSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Create blob attachment node with configurable preview style
 */
function createBlobAttachmentNode(previewStyle: BlobPreviewStyle) {
  return Node.create({
    name: "blobAttachment",
    group: previewStyle === "compact" ? "inline" : "block",
    inline: previewStyle === "compact",
    atom: true,

    addAttributes() {
      return {
        url: { default: null },
        sha256: { default: null },
        mimeType: { default: null },
        size: { default: null },
        server: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-blob-attachment="true"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, { "data-blob-attachment": "true" }),
      ];
    },

    addNodeView() {
      return ({ node }) => {
        const { url, mimeType, size } = node.attrs;
        const isImage = mimeType?.startsWith("image/");
        const isVideo = mimeType?.startsWith("video/");
        const isAudio = mimeType?.startsWith("audio/");

        const dom = document.createElement(
          previewStyle === "compact" ? "span" : "div",
        );
        dom.contentEditable = "false";

        if (previewStyle === "compact") {
          // Compact: small inline pill
          dom.className =
            "blob-attachment inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 border border-border text-xs align-middle";

          if (isImage && url) {
            const img = document.createElement("img");
            img.src = url;
            img.alt = "attachment";
            img.className = "h-4 w-4 object-cover rounded";
            img.draggable = false;
            dom.appendChild(img);
          } else {
            const icon = document.createElement("span");
            icon.className = "text-muted-foreground";
            icon.textContent = isVideo ? "🎬" : isAudio ? "🎵" : "📎";
            dom.appendChild(icon);
          }

          const label = document.createElement("span");
          label.className = "text-muted-foreground truncate max-w-[80px]";
          label.textContent = isImage
            ? "image"
            : isVideo
              ? "video"
              : isAudio
                ? "audio"
                : "file";
          dom.appendChild(label);

          if (size) {
            const sizeEl = document.createElement("span");
            sizeEl.className = "text-muted-foreground/70";
            sizeEl.textContent = formatBlobSize(size);
            dom.appendChild(sizeEl);
          }
        } else if (previewStyle === "card") {
          // Card: medium thumbnail card
          dom.className =
            "blob-attachment-card my-2 inline-flex items-center gap-3 p-2 rounded-lg bg-muted/30 border border-border max-w-xs";

          if (isImage && url) {
            const img = document.createElement("img");
            img.src = url;
            img.alt = "attachment";
            img.className = "h-16 w-16 object-cover rounded";
            img.draggable = false;
            dom.appendChild(img);
          } else {
            const iconWrapper = document.createElement("div");
            iconWrapper.className =
              "h-16 w-16 flex items-center justify-center bg-muted rounded";
            const icon = document.createElement("span");
            icon.className = "text-2xl";
            icon.textContent = isVideo ? "🎬" : isAudio ? "🎵" : "📎";
            iconWrapper.appendChild(icon);
            dom.appendChild(iconWrapper);
          }

          const info = document.createElement("div");
          info.className = "flex flex-col gap-0.5 min-w-0";

          const typeLabel = document.createElement("span");
          typeLabel.className = "text-sm font-medium capitalize";
          typeLabel.textContent = isImage
            ? "Image"
            : isVideo
              ? "Video"
              : isAudio
                ? "Audio"
                : "File";
          info.appendChild(typeLabel);

          if (size) {
            const sizeEl = document.createElement("span");
            sizeEl.className = "text-xs text-muted-foreground";
            sizeEl.textContent = formatBlobSize(size);
            info.appendChild(sizeEl);
          }

          dom.appendChild(info);
        } else {
          // Gallery: full-width preview
          dom.className = "blob-attachment-gallery my-2 w-full";

          if (isImage && url) {
            const img = document.createElement("img");
            img.src = url;
            img.alt = "attachment";
            img.className = "max-w-full max-h-64 rounded-lg object-contain";
            img.draggable = false;
            dom.appendChild(img);
          } else if (isVideo && url) {
            const video = document.createElement("video");
            video.src = url;
            video.className = "max-w-full max-h-64 rounded-lg";
            video.controls = true;
            dom.appendChild(video);
          } else if (isAudio && url) {
            const audio = document.createElement("audio");
            audio.src = url;
            audio.className = "w-full";
            audio.controls = true;
            dom.appendChild(audio);
          } else {
            const fileCard = document.createElement("div");
            fileCard.className =
              "inline-flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border";
            const icon = document.createElement("span");
            icon.className = "text-xl";
            icon.textContent = "📎";
            fileCard.appendChild(icon);
            const label = document.createElement("span");
            label.className = "text-sm";
            label.textContent = size
              ? `File (${formatBlobSize(size)})`
              : "File";
            fileCard.appendChild(label);
            dom.appendChild(fileCard);
          }
        }

        return { dom };
      };
    },
  });
}

export const NostrEditor = forwardRef<NostrEditorHandle, NostrEditorProps>(
  (
    {
      placeholder = "Type a message...",
      initialContent,
      onSubmit,
      onChange,
      onReady,
      submitBehavior = "enter",
      variant = "inline",
      minLines = 1,
      maxLines = 10,
      blobPreview = "compact",
      suggestions = [],
      autoFocus = false,
      className = "",
    },
    ref,
  ) => {
    const handleSubmitRef = useRef<(editor: unknown) => void>(() => {});

    // Helper function to serialize editor content
    const serializeContent = useCallback(
      (editorInstance: {
        getJSON: () => { content?: unknown[] };
        getText: () => string;
      }): SerializedContent => {
        let text = "";
        const emojiTags: EmojiTag[] = [];
        const blobAttachments: BlobAttachment[] = [];
        const seenEmojis = new Set<string>();
        const seenBlobs = new Set<string>();
        const json = editorInstance.getJSON();

        const processNode = (node: Record<string, unknown>) => {
          if (node.type === "text") {
            text += node.text as string;
          } else if (node.type === "hardBreak") {
            text += "\n";
          } else if (node.type === "mention") {
            const attrs = node.attrs as Record<string, unknown>;
            const pubkey = attrs?.id as string;
            if (pubkey) {
              try {
                const npub = nip19.npubEncode(pubkey);
                text += `nostr:${npub}`;
              } catch {
                text += `@${(attrs?.label as string) || "unknown"}`;
              }
            }
          } else if (node.type === "emoji") {
            const attrs = node.attrs as Record<string, unknown>;
            const shortcode = attrs?.id as string;
            const url = attrs?.url as string;
            const source = attrs?.source as string;

            if (source === "unicode" && url) {
              text += url;
            } else if (shortcode) {
              text += `:${shortcode}:`;
              if (url && !seenEmojis.has(shortcode)) {
                seenEmojis.add(shortcode);
                emojiTags.push({ shortcode, url });
              }
            }
          } else if (node.type === "blobAttachment") {
            const attrs = node.attrs as Record<string, unknown>;
            const url = attrs.url as string;
            const sha256 = attrs.sha256 as string;
            if (url) {
              text += url;
              if (sha256 && !seenBlobs.has(sha256)) {
                seenBlobs.add(sha256);
                blobAttachments.push({
                  url,
                  sha256,
                  mimeType: (attrs.mimeType as string) || undefined,
                  size: (attrs.size as number) || undefined,
                  server: (attrs.server as string) || undefined,
                });
              }
            }
          }
        };

        const processContent = (content: unknown[]) => {
          for (const node of content) {
            const n = node as Record<string, unknown>;
            if (n.type === "paragraph" || n.type === "doc") {
              if (n.content) {
                processContent(n.content as unknown[]);
              }
              if (n.type === "paragraph") {
                text += "\n";
              }
            } else {
              processNode(n);
            }
          }
        };

        if (json.content) {
          processContent(json.content);
        }

        return {
          text: text.trim(),
          emojiTags,
          blobAttachments,
        };
      },
      [],
    );

    // Helper function to handle submission
    const handleSubmit = useCallback(
      (editorInstance: unknown) => {
        if (!editorInstance || !onSubmit) return;
        const editor = editorInstance as {
          getJSON: () => { content?: unknown[] };
          getText: () => string;
          commands: { clearContent: () => void };
        };

        const content = serializeContent(editor);
        if (content.text) {
          onSubmit(content);
          editor.commands.clearContent();
        }
      },
      [onSubmit, serializeContent],
    );

    handleSubmitRef.current = handleSubmit;

    // Extract and memoize individual suggestion configs to avoid unnecessary recalculations
    const mentionConfig = useMemo(
      () => suggestions.find((s) => s.char === "@"),
      [suggestions],
    );
    const emojiConfig = useMemo(
      () => suggestions.find((s) => s.char === ":"),
      [suggestions],
    );
    const slashConfig = useMemo(
      () => suggestions.find((s) => s.char === "/"),
      [suggestions],
    );

    // Create TipTap suggestion configs directly inline (matching main branch pattern)
    // This ensures stable function references for items() and render()
    const tipTapMentionConfig = useMemo(() => {
      if (!mentionConfig) return null;

      return {
        char: mentionConfig.char,
        allowSpaces: mentionConfig.allowSpaces ?? false,
        allow: mentionConfig.allow,
        items: async ({ query }: { query: string }) => {
          return await mentionConfig.search(query);
        },
        render: () => {
          let component: ReactRenderer<SuggestionListHandle> | null = null;
          let popup: TippyInstance[] | null = null;
          let editorRef: unknown = null;

          return {
            onStart: (props: {
              editor: unknown;
              items: unknown[];
              command: unknown;
              clientRect?: () => DOMRect;
            }) => {
              editorRef = props.editor;
              component = new ReactRenderer(mentionConfig.component as never, {
                props: {
                  items: props.items,
                  command: props.command,
                  onClose: () => popup?.[0]?.hide(),
                },
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: mentionConfig.placement ?? "bottom-start",
                zIndex: 100,
              });
            },

            onUpdate(props: {
              items: unknown[];
              command: unknown;
              clientRect?: () => DOMRect;
            }) {
              if (component) {
                component.updateProps({
                  items: props.items,
                  command: props.command,
                });
              }

              if (props.clientRect && popup?.[0]) {
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect,
                });
              }
            },

            onKeyDown(props: { event: KeyboardEvent }) {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }

              if (
                props.event.key === "Enter" &&
                (props.event.ctrlKey || props.event.metaKey)
              ) {
                popup?.[0]?.hide();
                handleSubmitRef.current(editorRef);
                return true;
              }

              return component?.ref?.onKeyDown(props.event) ?? false;
            },

            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
              component = null;
              popup = null;
            },
          };
        },
      };
    }, [mentionConfig]);

    const tipTapEmojiConfig = useMemo(() => {
      if (!emojiConfig) return null;

      return {
        char: emojiConfig.char,
        allowSpaces: emojiConfig.allowSpaces ?? false,
        allow: emojiConfig.allow,
        items: async ({ query }: { query: string }) => {
          return await emojiConfig.search(query);
        },
        render: () => {
          let component: ReactRenderer<SuggestionListHandle> | null = null;
          let popup: TippyInstance[] | null = null;
          let editorRef: unknown = null;

          return {
            onStart: (props: {
              editor: unknown;
              items: unknown[];
              command: unknown;
              clientRect?: () => DOMRect;
            }) => {
              editorRef = props.editor;
              component = new ReactRenderer(emojiConfig.component as never, {
                props: {
                  items: props.items,
                  command: props.command,
                  onClose: () => popup?.[0]?.hide(),
                },
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: emojiConfig.placement ?? "bottom-start",
                zIndex: 100,
              });
            },

            onUpdate(props: {
              items: unknown[];
              command: unknown;
              clientRect?: () => DOMRect;
            }) {
              if (component) {
                component.updateProps({
                  items: props.items,
                  command: props.command,
                });
              }

              if (props.clientRect && popup?.[0]) {
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect,
                });
              }
            },

            onKeyDown(props: { event: KeyboardEvent }) {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }

              if (
                props.event.key === "Enter" &&
                (props.event.ctrlKey || props.event.metaKey)
              ) {
                popup?.[0]?.hide();
                handleSubmitRef.current(editorRef);
                return true;
              }

              return component?.ref?.onKeyDown(props.event) ?? false;
            },

            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
              component = null;
              popup = null;
            },
          };
        },
      };
    }, [emojiConfig]);

    const tipTapSlashConfig = useMemo(() => {
      if (!slashConfig) return null;

      return {
        char: slashConfig.char,
        allowSpaces: slashConfig.allowSpaces ?? false,
        allow: slashConfig.allow,
        items: async ({ query }: { query: string }) => {
          return await slashConfig.search(query);
        },
        render: () => {
          let component: ReactRenderer<SuggestionListHandle> | null = null;
          let popup: TippyInstance[] | null = null;
          let editorRef: unknown = null;

          return {
            onStart: (props: {
              editor: unknown;
              items: unknown[];
              command: unknown;
              clientRect?: () => DOMRect;
            }) => {
              editorRef = props.editor;
              component = new ReactRenderer(slashConfig.component as never, {
                props: {
                  items: props.items,
                  command: props.command,
                  onClose: () => popup?.[0]?.hide(),
                },
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: slashConfig.placement ?? "top-start",
                zIndex: 100,
              });
            },

            onUpdate(props: {
              items: unknown[];
              command: unknown;
              clientRect?: () => DOMRect;
            }) {
              if (component) {
                component.updateProps({
                  items: props.items,
                  command: props.command,
                });
              }

              if (props.clientRect && popup?.[0]) {
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect,
                });
              }
            },

            onKeyDown(props: { event: KeyboardEvent }) {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }

              if (
                props.event.key === "Enter" &&
                (props.event.ctrlKey || props.event.metaKey)
              ) {
                popup?.[0]?.hide();
                handleSubmitRef.current(editorRef);
                return true;
              }

              return component?.ref?.onKeyDown(props.event) ?? false;
            },

            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
              component = null;
              popup = null;
            },
          };
        },
      };
    }, [slashConfig]);

    // Build extensions array
    const extensions = useMemo(() => {
      const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;

      // Custom extension for keyboard shortcuts
      const SubmitShortcut = Extension.create({
        name: "submitShortcut",
        addKeyboardShortcuts() {
          return {
            "Mod-Enter": ({ editor }) => {
              handleSubmitRef.current(editor);
              return true;
            },
            Enter: ({ editor }) => {
              if (submitBehavior === "button-only") {
                // Never submit on Enter, always newline
                return editor.commands.setHardBreak();
              } else if (submitBehavior === "ctrl-enter") {
                // Enter always inserts newline
                return editor.commands.setHardBreak();
              } else {
                // submitBehavior === 'enter'
                if (isMobile) {
                  return editor.commands.setHardBreak();
                } else {
                  handleSubmitRef.current(editor);
                  return true;
                }
              }
            },
          };
        },
      });

      const exts: AnyExtension[] = [
        SubmitShortcut,
        StarterKit.configure({
          hardBreak: { keepMarks: false },
        }),
        Placeholder.configure({ placeholder }),
        createBlobAttachmentNode(blobPreview),
      ];

      // Add mention extension for @ mentions
      if (tipTapMentionConfig && mentionConfig) {
        exts.push(
          Mention.configure({
            HTMLAttributes: { class: "mention" },
            suggestion: {
              ...tipTapMentionConfig,
              command: ({
                editor,
                range,
                props,
              }: {
                editor: unknown;
                range: unknown;
                props: unknown;
              }) => {
                const result = mentionConfig.onSelect(props as never);
                const ed = editor as {
                  chain: () => {
                    focus: () => {
                      insertContentAt: (
                        range: unknown,
                        content: unknown[],
                      ) => { run: () => void };
                    };
                  };
                };
                ed.chain()
                  .focus()
                  .insertContentAt(range, [
                    { type: result.type, attrs: result.attrs },
                    { type: "text", text: " " },
                  ])
                  .run();
              },
            },
            renderLabel({ node }) {
              return `@${node.attrs.label}`;
            },
          }),
        );
      }

      // Add emoji extension
      if (tipTapEmojiConfig && emojiConfig) {
        exts.push(
          EmojiMention.configure({
            HTMLAttributes: { class: "emoji" },
            suggestion: {
              ...tipTapEmojiConfig,
              command: ({
                editor,
                range,
                props,
              }: {
                editor: unknown;
                range: unknown;
                props: unknown;
              }) => {
                const result = emojiConfig.onSelect(props as never);
                const ed = editor as {
                  chain: () => {
                    focus: () => {
                      insertContentAt: (
                        range: unknown,
                        content: unknown[],
                      ) => { run: () => void };
                    };
                  };
                };
                ed.chain()
                  .focus()
                  .insertContentAt(range, [
                    { type: "emoji", attrs: result.attrs },
                    { type: "text", text: " " },
                  ])
                  .run();
              },
            },
          }),
        );
      }

      // Add slash command extension
      if (tipTapSlashConfig && slashConfig) {
        const SlashCommand = Mention.extend({ name: "slashCommand" });
        exts.push(
          SlashCommand.configure({
            HTMLAttributes: { class: "slash-command" },
            suggestion: {
              ...tipTapSlashConfig,
              command: ({
                editor,
                props,
              }: {
                editor: unknown;
                props: unknown;
              }) => {
                const ed = editor as { commands: { clearContent: () => void } };
                if (slashConfig.clearOnSelect !== false) {
                  ed.commands.clearContent();
                }
                if (slashConfig.onExecute) {
                  slashConfig.onExecute(props as never).catch((error) => {
                    console.error(
                      "[NostrEditor] Command execution failed:",
                      error,
                    );
                  });
                }
              },
            },
            renderLabel({ node }) {
              return `/${node.attrs.label}`;
            },
          }),
        );
      }

      return exts;
    }, [
      submitBehavior,
      placeholder,
      blobPreview,
      mentionConfig,
      emojiConfig,
      slashConfig,
      tipTapMentionConfig,
      tipTapEmojiConfig,
      tipTapSlashConfig,
    ]);

    const editor = useEditor({
      extensions,
      content: initialContent,
      editorProps: {
        attributes: {
          class: "prose prose-sm max-w-none focus:outline-none text-sm",
        },
      },
      autofocus: autoFocus,
      onCreate: () => {
        // Notify parent that editor is ready for operations like loading drafts
        onReady?.();
      },
      onUpdate: ({ editor }) => {
        if (onChange) {
          onChange(serializeContent(editor));
        }
      },
    });

    // Expose editor methods
    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
        clear: () => editor?.commands.clearContent(),
        getContent: () => editor?.getText() || "",
        getSerializedContent: () => {
          if (!editor) return { text: "", emojiTags: [], blobAttachments: [] };
          return serializeContent(editor);
        },
        getJSON: () => editor?.getJSON() || null,
        setContent: (content: string | object) => {
          if (editor) {
            editor.commands.setContent(content);
          }
        },
        isEmpty: () => editor?.isEmpty ?? true,
        submit: () => {
          if (editor) {
            handleSubmit(editor);
          }
        },
        insertText: (text: string) => {
          if (editor) {
            editor.chain().focus().insertContent(text).run();
          }
        },
        insertBlob: (blob: BlobAttachment) => {
          if (editor) {
            editor
              .chain()
              .focus()
              .insertContent([
                {
                  type: "blobAttachment",
                  attrs: {
                    url: blob.url,
                    sha256: blob.sha256,
                    mimeType: blob.mimeType,
                    size: blob.size,
                    server: blob.server,
                  },
                },
                { type: "text", text: " " },
              ])
              .run();
          }
        },
      }),
      [editor, serializeContent, handleSubmit],
    );

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        editor?.destroy();
      };
    }, [editor]);

    if (!editor) {
      return null;
    }

    // Inline styles for dynamic height (Tailwind can't do dynamic values)
    const getInlineStyles = (): React.CSSProperties => {
      const lineHeight = 24;

      switch (variant) {
        case "inline":
          return {};
        case "multiline":
          return {
            minHeight: `${Math.max(minLines, 2) * lineHeight}px`,
            maxHeight: `${maxLines * lineHeight}px`,
          };
        case "full":
          return {
            height: `${Math.max(minLines, 5) * lineHeight}px`,
          };
        default:
          return {};
      }
    };

    return (
      <div
        className={cn(
          "rounded border bg-background transition-colors focus-within:border-primary px-2",
          variant === "inline" && "h-7 flex items-center overflow-hidden",
          variant !== "inline" && "py-2 overflow-y-auto",
          variant === "full" && "resize-y min-h-[100px]",
          className,
        )}
        style={getInlineStyles()}
      >
        <EditorContent
          editor={editor}
          className={cn("flex-1 min-w-0", variant !== "inline" && "h-full")}
        />
      </div>
    );
  },
);

NostrEditor.displayName = "NostrEditor";
