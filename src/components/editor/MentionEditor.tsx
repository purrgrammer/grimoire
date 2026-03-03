import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { ProfileSuggestionList } from "./ProfileSuggestionList";
import { EmojiSuggestionList } from "./EmojiSuggestionList";
import { SlashCommandSuggestionList } from "./SlashCommandSuggestionList";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { ChatAction } from "@/types/chat-actions";
import { NostrPasteHandler } from "./extensions/nostr-paste-handler";
import { FilePasteHandler } from "./extensions/file-paste-handler";
import { EmojiMention } from "./extensions/emoji";
import { BlobAttachmentInlineNode } from "./extensions/blob-attachment-inline";
import { NostrEventPreviewInlineNode } from "./extensions/nostr-event-preview-inline";
import { SubmitShortcut } from "./extensions/submit-shortcut";
import { serializeInlineContent } from "./utils/serialize";
import { useSuggestionRenderer } from "./hooks/useSuggestionRenderer";
import type { EmojiTag, BlobAttachment, SerializedContent } from "./types";

// Re-export types for backward compatibility
export type { EmojiTag, BlobAttachment, SerializedContent } from "./types";

export interface MentionEditorProps {
  placeholder?: string;
  onSubmit?: (
    content: string,
    emojiTags: EmojiTag[],
    blobAttachments: BlobAttachment[],
  ) => void;
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  searchCommands?: (query: string) => Promise<ChatAction[]>;
  onCommandExecute?: (action: ChatAction) => Promise<void>;
  onFilePaste?: (files: File[]) => void;
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
  /** Insert text at the current cursor position */
  insertText: (text: string) => void;
  /** Insert a blob attachment with rich preview */
  insertBlob: (blob: BlobAttachment) => void;
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
      searchEmojis,
      searchCommands,
      onCommandExecute,
      onFilePaste,
      autoFocus = false,
      className = "",
    },
    ref,
  ) => {
    const handleSubmitRef = useRef<(editor: any) => void>(() => {});

    const handleSubmit = useCallback(
      (editorInstance: any) => {
        if (!editorInstance || !onSubmit) return;

        const { text, emojiTags, blobAttachments } =
          serializeInlineContent(editorInstance);
        if (text) {
          onSubmit(text, emojiTags, blobAttachments);
          editorInstance.commands.clearContent();
        }
      },
      [onSubmit],
    );

    handleSubmitRef.current = handleSubmit;

    // React-based suggestion renderers (replace tippy.js + ReactRenderer)
    const { render: renderMentionSuggestion, portal: mentionPortal } =
      useSuggestionRenderer<ProfileSearchResult>(ProfileSuggestionList as any, {
        onModEnter: () => {
          // Submit via the ref when Ctrl/Cmd+Enter is pressed in suggestion
        },
      });

    const { render: renderEmojiSuggestion, portal: emojiPortal } =
      useSuggestionRenderer<EmojiSearchResult>(EmojiSuggestionList as any);

    const { render: renderSlashSuggestion, portal: slashPortal } =
      useSuggestionRenderer<ChatAction>(SlashCommandSuggestionList as any, {
        placement: "top-start",
      });

    // Mention suggestion config
    const mentionSuggestion: Omit<SuggestionOptions, "editor"> = useMemo(
      () => ({
        char: "@",
        allowSpaces: false,
        items: async ({ query }) => searchProfiles(query),
        render: renderMentionSuggestion,
      }),
      [searchProfiles, renderMentionSuggestion],
    );

    // Emoji suggestion config
    const emojiSuggestion: Omit<SuggestionOptions, "editor"> | null = useMemo(
      () =>
        searchEmojis
          ? {
              char: ":",
              allowSpaces: false,
              items: async ({ query }) => searchEmojis(query),
              render: renderEmojiSuggestion,
            }
          : null,
      [searchEmojis, renderEmojiSuggestion],
    );

    // Slash command suggestion config
    const slashCommandSuggestion: Omit<SuggestionOptions, "editor"> | null =
      useMemo(
        () =>
          searchCommands
            ? {
                char: "/",
                allowSpaces: false,
                // Only allow slash commands at the start of input
                allow: ({ range }) => range.from === 1,
                items: async ({ query }) => searchCommands(query),
                render: renderSlashSuggestion,
              }
            : null,
        [searchCommands, renderSlashSuggestion],
      );

    // Detect mobile devices (touch support)
    const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Build extensions
    const extensions = useMemo(() => {
      const exts = [
        SubmitShortcut.configure({
          submitRef: handleSubmitRef,
          enterSubmits: !isMobile,
        }),
        StarterKit.configure({
          hardBreak: { keepMarks: false },
        }),
        Mention.configure({
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
                    attrs: { id: props.pubkey, label: props.displayName },
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
        BlobAttachmentInlineNode,
        NostrEventPreviewInlineNode,
        NostrPasteHandler,
        FilePasteHandler.configure({ onFilePaste }),
      ];

      // Add emoji extension if search is provided
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
                        mentionSuggestionChar: ":",
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

      // Add slash command extension if search is provided
      if (slashCommandSuggestion) {
        const SlashCommand = Mention.extend({ name: "slashCommand" });
        exts.push(
          SlashCommand.configure({
            HTMLAttributes: { class: "slash-command" },
            suggestion: {
              ...slashCommandSuggestion,
              command: ({ editor, props }: any) => {
                editor.commands.clearContent();
                if (onCommandExecute) {
                  onCommandExecute(props).catch((error) => {
                    console.error(
                      "[MentionEditor] Command execution failed:",
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
      mentionSuggestion,
      emojiSuggestion,
      slashCommandSuggestion,
      onCommandExecute,
      onFilePaste,
      placeholder,
      isMobile,
    ]);

    const editor = useEditor({
      extensions,
      editorProps: {
        attributes: {
          class: "prose prose-sm max-w-none focus:outline-none text-sm",
        },
      },
      autofocus: autoFocus,
    });

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
          return serializeInlineContent(editor);
        },
        isEmpty: () => editor?.isEmpty ?? true,
        submit: () => {
          if (editor) handleSubmit(editor);
        },
        insertText: (text: string) => {
          if (editor) editor.chain().focus().insertContent(text).run();
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
      [editor, handleSubmit],
    );

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        editor?.destroy();
      };
    }, [editor]);

    if (!editor) return null;

    return (
      <div
        className={`rounded border bg-background transition-colors focus-within:border-primary min-h-7 max-h-20 flex items-start overflow-y-auto py-1 px-2 ${className}`}
      >
        <EditorContent editor={editor} className="flex-1 min-w-0" />
        {mentionPortal}
        {emojiPortal}
        {slashPortal}
      </div>
    );
  },
);

MentionEditor.displayName = "MentionEditor";
