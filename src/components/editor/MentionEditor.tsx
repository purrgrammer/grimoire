import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { ReactRenderer } from "@tiptap/react";
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
import type { ProfileSearchResult } from "@/services/profile-search";
import { nip19 } from "nostr-tools";

export interface MentionEditorProps {
  placeholder?: string;
  onSubmit?: (content: string) => void;
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  autoFocus?: boolean;
  className?: string;
}

export interface MentionEditorHandle {
  focus: () => void;
  clear: () => void;
  getContent: () => string;
  getContentWithMentions: () => string;
  isEmpty: () => boolean;
  submit: () => void;
}

export const MentionEditor = forwardRef<
  MentionEditorHandle,
  MentionEditorProps
>(
  (
    {
      placeholder = "Type a message...",
      onSubmit,
      searchProfiles,
      autoFocus = true,
      className = "",
    },
    ref,
  ) => {
    // Create mention suggestion configuration
    const suggestion: Omit<SuggestionOptions, "editor"> = useMemo(
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

    // Helper function to serialize editor content with mentions
    const serializeContent = useCallback((editorInstance: any) => {
      let text = "";
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
            }
          });
          text += "\n";
        }
      });

      return text.trim();
    }, []);

    // Helper function to handle submission
    const handleSubmit = useCallback(
      (editorInstance: any) => {
        if (!editorInstance || !onSubmit) return;

        const content = serializeContent(editorInstance);
        if (content) {
          onSubmit(content);
          editorInstance.commands.clearContent();
        }
      },
      [onSubmit, serializeContent],
    );

    const editor = useEditor({
      extensions: [
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
            ...suggestion,
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
      ],
      editorProps: {
        attributes: {
          class:
            "prose prose-sm max-w-none focus:outline-none min-h-[2rem] px-3 py-1.5",
        },
        handleKeyDown: (view, event) => {
          // Submit on Enter (without Shift)
          if (event.key === "Enter" && !event.shiftKey) {
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
        getContentWithMentions: () => {
          if (!editor) return "";
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
