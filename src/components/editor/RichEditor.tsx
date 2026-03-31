import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { ProfileSuggestionList } from "./ProfileSuggestionList";
import { EmojiSuggestionList } from "./EmojiSuggestionList";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";
import { recordEmojiUsage } from "@/services/emoji-usage";
import { nip19 } from "nostr-tools";
import { NostrPasteHandler } from "./extensions/nostr-paste-handler";
import { FilePasteHandler } from "./extensions/file-paste-handler";
import { BlobAttachmentRichNode } from "./extensions/blob-attachment-rich";
import { NostrEventPreviewRichNode } from "./extensions/nostr-event-preview-rich";
import { EmojiMention } from "./extensions/emoji";
import { SubmitShortcut } from "./extensions/submit-shortcut";
import { serializeRichContent } from "./utils/serialize";
import { useSuggestionRenderer } from "./hooks/useSuggestionRenderer";
import type { BlobAttachment, SerializedContent } from "./types";

export type { EmojiTag, BlobAttachment, SerializedContent } from "./types";

export interface RichEditorProps {
  placeholder?: string;
  onSubmit?: (
    content: string,
    emojiTags: Array<{ shortcode: string; url: string }>,
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
    const handleSubmitRef = useRef<(editor: any) => void>(() => {});

    const handleSubmit = useCallback(
      (editorInstance: any) => {
        if (editorInstance.isEmpty) return;

        const serialized = serializeRichContent(editorInstance);
        onSubmit?.(
          serialized.text,
          serialized.emojiTags,
          serialized.blobAttachments,
          serialized.addressRefs,
        );
      },
      [onSubmit],
    );

    handleSubmitRef.current = handleSubmit;

    // React-based suggestion renderers (replace tippy.js)
    const { render: renderMentionSuggestion, portal: mentionPortal } =
      useSuggestionRenderer<ProfileSearchResult>(ProfileSuggestionList as any);

    const { render: renderEmojiSuggestion, portal: emojiPortal } =
      useSuggestionRenderer<EmojiSearchResult>(EmojiSuggestionList as any);

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
    const emojiSuggestion: Omit<SuggestionOptions, "editor"> | undefined =
      useMemo(() => {
        if (!searchEmojis) return undefined;
        return {
          char: ":",
          allowSpaces: false,
          items: async ({ query }) => searchEmojis(query),
          render: renderEmojiSuggestion,
        };
      }, [searchEmojis, renderEmojiSuggestion]);

    // Build extensions
    const extensions = useMemo(() => {
      const exts = [
        SubmitShortcut.configure({
          submitRef: handleSubmitRef,
          enterSubmits: false,
        }),
        StarterKit.configure({
          hardBreak: { keepMarks: false },
          // Disable all rich text / markdown syntax — these are plain text editors
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          heading: false,
          horizontalRule: false,
        }),
        Mention.extend({
          renderText({ node }) {
            try {
              return `nostr:${nip19.npubEncode(node.attrs.id)}`;
            } catch (err) {
              console.error("[Mention] Failed to encode pubkey:", err);
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
                recordEmojiUsage(props);
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
      onUpdate: () => onChange?.(),
    });

    const isEditorReady = useCallback(() => {
      return editor && editor.view && editor.view.dom;
    }, [editor]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (isEditorReady()) editor?.commands.focus();
        },
        clear: () => {
          if (isEditorReady()) editor?.commands.clearContent();
        },
        getContent: () => {
          if (!isEditorReady()) return "";
          return editor?.getText({ blockSeparator: "\n" }) || "";
        },
        getSerializedContent: () => {
          if (!isEditorReady() || !editor)
            return {
              text: "",
              emojiTags: [],
              blobAttachments: [],
              addressRefs: [],
            };
          return serializeRichContent(editor);
        },
        isEmpty: () => {
          if (!isEditorReady()) return true;
          return editor?.isEmpty ?? true;
        },
        submit: () => {
          if (isEditorReady() && editor) handleSubmit(editor);
        },
        insertText: (text: string) => {
          if (isEditorReady()) editor?.commands.insertContent(text);
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
          if (isEditorReady() && json) editor?.commands.setContent(json);
        },
      }),
      [editor, handleSubmit, isEditorReady],
    );

    if (!editor) return null;

    return (
      <div className={`rich-editor ${className}`}>
        <EditorContent editor={editor} />
        {mentionPortal}
        {emojiPortal}
      </div>
    );
  },
);

RichEditor.displayName = "RichEditor";
