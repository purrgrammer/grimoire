import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import type { NostrEvent } from "nostr-tools";
import {
  MentionEditor,
  type MentionEditorHandle,
  type EmojiTag,
  type BlobAttachment,
} from "./MentionEditor";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { ChatAction } from "@/types/chat-actions";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { UserName } from "../nostr/UserName";
import { RichText } from "../nostr/RichText";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

/**
 * Result when submitting a post
 */
export interface PostSubmitData {
  content: string;
  emojiTags: EmojiTag[];
  blobAttachments: BlobAttachment[];
  title?: string; // For kind 11 threads
}

/**
 * Props for PostComposer component
 */
export interface PostComposerProps {
  /** Callback when post is submitted */
  onSubmit: (data: PostSubmitData) => void | Promise<void>;
  /** Profile search function for @ mentions */
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  /** Emoji search function for : autocomplete (optional) */
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  /** Slash command search (optional) */
  searchCommands?: (query: string) => Promise<ChatAction[]>;
  /** Command execution handler (optional) */
  onCommandExecute?: (action: ChatAction) => Promise<void>;
  /** Event being replied to (full event object, not just ID) */
  replyTo?: NostrEvent;
  /** Clear reply context */
  onClearReply?: () => void;
  /** Variant style */
  variant?: "inline" | "card";
  /** Show title input (for kind 11 threads) */
  showTitleInput?: boolean;
  /** Placeholder for editor */
  placeholder?: string;
  /** Placeholder for title input */
  titlePlaceholder?: string;
  /** Show submit button */
  showSubmitButton?: boolean;
  /** Submit button label */
  submitLabel?: string;
  /** Loading state (disables inputs) */
  isLoading?: boolean;
  /** Auto focus editor on mount */
  autoFocus?: boolean;
  /** Custom CSS class */
  className?: string;
}

export interface PostComposerHandle {
  /** Focus the editor */
  focus: () => void;
  /** Clear the editor and title */
  clear: () => void;
  /** Check if editor is empty */
  isEmpty: () => boolean;
  /** Programmatically submit */
  submit: () => void;
}

/**
 * ComposerReplyPreview - Shows who is being replied to in the composer
 */
function ComposerReplyPreview({
  replyTo,
  onClear,
}: {
  replyTo: NostrEvent;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-1.5 overflow-hidden">
      <span className="flex-shrink-0">↳</span>
      <UserName pubkey={replyTo.pubkey} className="font-medium flex-shrink-0" />
      <div className="flex-1 min-w-0 line-clamp-1 overflow-hidden text-muted-foreground">
        <RichText
          event={replyTo}
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      </div>
      {onClear && (
        <button
          onClick={onClear}
          className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/**
 * PostComposer - Generalized post composer for Nostr events
 *
 * Supports two variants:
 * - inline: Compact single-row (for chat messages, quick replies)
 * - card: Multi-row with larger previews (for timeline posts, threads)
 *
 * Features:
 * - @ mention autocomplete (NIP-19 npub encoding)
 * - : emoji autocomplete (unicode + custom emoji with NIP-30 tags)
 * - / slash commands (optional)
 * - Blob attachments (NIP-92 imeta tags)
 * - Reply context preview
 * - Title input (for kind 11 threads)
 *
 * @example
 * ```tsx
 * // Inline composer (chat style)
 * <PostComposer
 *   variant="inline"
 *   onSubmit={handleSend}
 *   searchProfiles={searchProfiles}
 *   searchEmojis={searchEmojis}
 * />
 *
 * // Card composer (timeline post)
 * <PostComposer
 *   variant="card"
 *   onSubmit={handlePublish}
 *   searchProfiles={searchProfiles}
 *   showSubmitButton
 *   submitLabel="Publish"
 * />
 *
 * // Thread composer (kind 11)
 * <PostComposer
 *   variant="card"
 *   showTitleInput
 *   onSubmit={handlePublishThread}
 *   searchProfiles={searchProfiles}
 * />
 * ```
 */
export const PostComposer = forwardRef<PostComposerHandle, PostComposerProps>(
  (
    {
      onSubmit,
      searchProfiles,
      searchEmojis,
      searchCommands,
      onCommandExecute,
      replyTo,
      onClearReply,
      variant = "inline",
      showTitleInput = false,
      placeholder = "Type a message...",
      titlePlaceholder = "Thread title...",
      showSubmitButton = false,
      submitLabel = "Send",
      isLoading = false,
      autoFocus = false,
      className = "",
    },
    ref,
  ) => {
    const editorRef = useRef<MentionEditorHandle>(null);
    const [title, setTitle] = useState("");

    // Blossom upload hook
    const { open: openUpload, dialog: uploadDialog } = useBlossomUpload({
      accept: "image/*,video/*,audio/*",
      onSuccess: (results) => {
        if (results.length > 0 && editorRef.current) {
          const { blob, server } = results[0];
          editorRef.current.insertBlob({
            url: blob.url,
            sha256: blob.sha256,
            mimeType: blob.type,
            size: blob.size,
            server,
          });
          editorRef.current.focus();
        }
      },
    });

    // Handle submit
    const handleSubmit = async (
      content: string,
      emojiTags: EmojiTag[],
      blobAttachments: BlobAttachment[],
    ) => {
      if (!content.trim() && (!showTitleInput || !title.trim())) return;

      await onSubmit({
        content,
        emojiTags,
        blobAttachments,
        title: showTitleInput ? title : undefined,
      });

      // Clear editor and title after successful submit
      editorRef.current?.clear();
      if (showTitleInput) {
        setTitle("");
      }
    };

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        clear: () => {
          editorRef.current?.clear();
          setTitle("");
        },
        isEmpty: () => {
          const editorEmpty = editorRef.current?.isEmpty() ?? true;
          const titleEmpty = showTitleInput ? !title.trim() : true;
          return editorEmpty && titleEmpty;
        },
        submit: () => {
          editorRef.current?.submit();
        },
      }),
      [showTitleInput, title],
    );

    const isInline = variant === "inline";
    const isCard = variant === "card";

    return (
      <div
        className={`flex flex-col gap-1.5 ${isCard ? "p-3 border rounded-lg bg-card" : ""} ${className}`}
      >
        {/* Title input for threads (kind 11) */}
        {showTitleInput && (
          <Input
            type="text"
            placeholder={titlePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isLoading}
            className="font-semibold"
          />
        )}

        {/* Reply preview */}
        {replyTo && (
          <ComposerReplyPreview replyTo={replyTo} onClear={onClearReply} />
        )}

        {/* Editor row */}
        <div className="flex gap-1.5 items-center">
          {/* Attach button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`flex-shrink-0 text-muted-foreground hover:text-foreground ${isInline ? "size-7" : "size-9"}`}
                  onClick={openUpload}
                  disabled={isLoading}
                >
                  <Paperclip className={isInline ? "size-4" : "size-5"} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Attach media</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Editor */}
          <div className={`flex-1 min-w-0 ${isCard ? "editor-card" : ""}`}>
            <MentionEditor
              ref={editorRef}
              placeholder={placeholder}
              searchProfiles={searchProfiles}
              searchEmojis={searchEmojis}
              searchCommands={searchCommands}
              onCommandExecute={onCommandExecute}
              onSubmit={handleSubmit}
              autoFocus={autoFocus}
              className="w-full"
            />
          </div>

          {/* Submit button (optional) */}
          {showSubmitButton && (
            <Button
              type="button"
              variant="secondary"
              size={isInline ? "sm" : "default"}
              className={`flex-shrink-0 ${isInline ? "h-7 px-2 text-xs" : ""}`}
              disabled={isLoading}
              onClick={() => {
                editorRef.current?.submit();
              }}
            >
              {isLoading ? (
                <Loader2
                  className={`animate-spin ${isInline ? "size-3" : "size-4"}`}
                />
              ) : (
                submitLabel
              )}
            </Button>
          )}
        </div>

        {uploadDialog}
      </div>
    );
  },
);

PostComposer.displayName = "PostComposer";
