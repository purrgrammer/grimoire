import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
} from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
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

/**
 * Represents an emoji tag for NIP-30
 */
export interface EmojiTag {
  shortcode: string;
  url: string;
}

/**
 * Result of serializing editor content
 */
export interface SerializedContent {
  /** The text content with mentions as nostr: URIs and emoji as :shortcode: */
  text: string;
  /** Emoji tags to include in the event (NIP-30) */
  emojiTags: EmojiTag[];
}

export interface MentionEditorProps {
  placeholder?: string;
  onSubmit?: (content: string, emojiTags: EmojiTag[]) => void;
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  autoFocus?: boolean;
  className?: string;
}

export interface MentionEditorHandle {
  focus: () => void;
  clear: () => void;
  getContent: () => string;
  getSerializedContent: () => SerializedContent;
  isEmpty: () => boolean;
  submit: () => void;
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

export const MentionEditor = forwardRef<
  MentionEditorHandle,
  MentionEditorProps
>(
  (
    {
      placeholder = "Type a message...",
      onSubmit,
      searchProfiles,
      searchEmojis,
      autoFocus = false,
      className = "",
    },
    ref,
  ) => {
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
                props: {
                  items: props.items,
                  command: props.command,
                  onClose: () => {
                    popup[0]?.hide();
                  },
                },
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

              popup[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onKeyDown(props) {
              if (props.event.key === "Escape") {
                popup[0]?.hide();
                return true;
              }

              return component.ref?.onKeyDown(props.event) ?? false;
            },

            onExit() {
              popup[0]?.destroy();
              component.destroy();
            },
          };
        },
      }),
      [searchProfiles],
    );

    // Create emoji suggestion configuration for : emoji
    const emojiSuggestion: Omit<SuggestionOptions, "editor"> | null = useMemo(
      () =>
        searchEmojis
          ? {
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
                      props: {
                        items: props.items,
                        command: props.command,
                        onClose: () => {
                          popup[0]?.hide();
                        },
                      },
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

                    popup[0]?.setProps({
                      getReferenceClientRect: props.clientRect as () => DOMRect,
                    });
                  },

                  onKeyDown(props) {
                    if (props.event.key === "Escape") {
                      popup[0]?.hide();
                      return true;
                    }

                    return component.ref?.onKeyDown(props.event) ?? false;
                  },

                  onExit() {
                    popup[0]?.destroy();
                    component.destroy();
                  },
                };
              },
            }
          : null,
      [searchEmojis],
    );

    // Helper function to serialize editor content with mentions and emojis
    const serializeContent = useCallback(
      (editorInstance: any): SerializedContent => {
        let text = "";
        const emojiTags: EmojiTag[] = [];
        const seenEmojis = new Set<string>();
        const json = editorInstance.getJSON();

        json.content?.forEach((node: any) => {
          if (node.type === "paragraph") {
            node.content?.forEach((child: any) => {
              if (child.type === "text") {
                text += child.text;
              } else if (child.type === "mention") {
                const pubkey = child.attrs?.id;
                if (pubkey) {
                  try {
                    const npub = nip19.npubEncode(pubkey);
                    text += `nostr:${npub}`;
                  } catch {
                    // Fallback to display name if encoding fails
                    text += `@${child.attrs?.label || "unknown"}`;
                  }
                }
              } else if (child.type === "emoji") {
                const shortcode = child.attrs?.id;
                const url = child.attrs?.url;
                const source = child.attrs?.source;

                if (source === "unicode" && url) {
                  // Unicode emoji - output the actual character
                  text += url;
                } else if (shortcode) {
                  // Custom emoji - output :shortcode: and add tag
                  text += `:${shortcode}:`;

                  if (url && !seenEmojis.has(shortcode)) {
                    seenEmojis.add(shortcode);
                    emojiTags.push({ shortcode, url });
                  }
                }
              }
            });
            text += "\n";
          }
        });

        return {
          text: text.trim(),
          emojiTags,
        };
      },
      [],
    );

    // Helper function to handle submission
    const handleSubmit = useCallback(
      (editorInstance: any) => {
        if (!editorInstance || !onSubmit) return;

        const { text, emojiTags } = serializeContent(editorInstance);
        if (text) {
          onSubmit(text, emojiTags);
          editorInstance.commands.clearContent();
        }
      },
      [onSubmit, serializeContent],
    );

    // Build extensions array
    const extensions = useMemo(() => {
      const exts = [
        StarterKit.configure({
          // Disable Enter to submit via Mod-Enter instead
          hardBreak: {
            keepMarks: false,
          },
        }),
        Mention.configure({
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
            // Note: renderLabel is not used when nodeView is defined
          }),
        );
      }

      return exts;
    }, [mentionSuggestion, emojiSuggestion, placeholder]);

    const editor = useEditor({
      extensions,
      editorProps: {
        attributes: {
          class:
            "prose prose-sm max-w-none focus:outline-none min-h-[2rem] px-3 py-1.5",
        },
        handleKeyDown: (view, event) => {
          // Submit on Enter (without Shift) or Ctrl/Cmd+Enter
          if (
            event.key === "Enter" &&
            (!event.shiftKey || event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            // Get editor from view state
            const editorInstance = (view as any).editor;
            handleSubmit(editorInstance);
            return true;
          }
          return false;
        },
      },
      autofocus: autoFocus,
    });

    // Expose editor methods
    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
        clear: () => editor?.commands.clearContent(),
        getContent: () => editor?.getText() || "",
        getSerializedContent: () => {
          if (!editor) return { text: "", emojiTags: [] };
          return serializeContent(editor);
        },
        isEmpty: () => editor?.isEmpty ?? true,
        submit: () => {
          if (editor) {
            handleSubmit(editor);
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

    return (
      <div
        className={`rounded-md border bg-background transition-colors focus-within:border-primary h-[2.5rem] flex items-center ${className}`}
      >
        <EditorContent editor={editor} className="flex-1" />
      </div>
    );
  },
);

MentionEditor.displayName = "MentionEditor";
