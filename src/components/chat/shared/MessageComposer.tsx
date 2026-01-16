import { useRef } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MentionEditor,
  type MentionEditorHandle,
  type EmojiTag,
  type BlobAttachment,
} from "@/components/editor/MentionEditor";

interface MessageComposerProps {
  /** Placeholder text for the input */
  placeholder?: string;
  /** Whether sending is in progress */
  isSending: boolean;
  /** Whether the user can send messages */
  disabled?: boolean;
  /** Message to disable the composer (shown when disabled=true) */
  disabledMessage?: string;
  /** Optional reply preview to show above the input */
  replyPreview?: React.ReactNode;
  /** Search function for @ mentions */
  onSearchProfiles?: (query: string) => Promise<unknown[]>;
  /** Search function for : emoji autocomplete */
  onSearchEmojis?: (query: string) => Promise<unknown[]>;
  /** Search function for / command autocomplete */
  onSearchCommands?: (query: string) => Promise<unknown[]>;
  /** Called when a command is executed from autocomplete */
  onCommandExecute?: (command: unknown) => void | Promise<void>;
  /** Called when user submits a message */
  onSubmit: (
    content: string,
    emojiTags?: EmojiTag[],
    blobAttachments?: BlobAttachment[],
  ) => void;
  /** Optional attach button handler */
  onAttach?: () => void;
  /** Optional dialog for attachments (e.g., Blossom upload) */
  attachDialog?: React.ReactNode;
}

/**
 * MessageComposer - Generic message input component
 * Handles text input, reply preview, mentions, emojis, commands, and attachments
 */
export function MessageComposer({
  placeholder = "Type a message...",
  isSending,
  disabled = false,
  disabledMessage = "Sign in to send messages",
  replyPreview,
  onSearchProfiles,
  onSearchEmojis,
  onSearchCommands,
  onCommandExecute,
  onSubmit,
  onAttach,
  attachDialog,
}: MessageComposerProps) {
  const editorRef = useRef<MentionEditorHandle>(null);

  // Handle submission from editor or button
  const handleSubmit = (
    content: string,
    emojiTags?: EmojiTag[],
    blobAttachments?: BlobAttachment[],
  ) => {
    if (content.trim() && !disabled) {
      onSubmit(content, emojiTags, blobAttachments);
    }
  };

  if (disabled) {
    return (
      <div className="border-t px-3 py-2 text-center text-sm text-muted-foreground">
        {disabledMessage}
      </div>
    );
  }

  return (
    <div className="border-t px-2 py-1 pb-0">
      {replyPreview}
      <div className="flex gap-1.5 items-center">
        {onAttach && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0 size-7 text-muted-foreground hover:text-foreground"
                  onClick={onAttach}
                  disabled={isSending}
                >
                  <Paperclip className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Attach media</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <MentionEditor
          ref={editorRef}
          placeholder={placeholder}
          searchProfiles={onSearchProfiles as any}
          searchEmojis={onSearchEmojis as any}
          searchCommands={onSearchCommands as any}
          onCommandExecute={onCommandExecute as any}
          onSubmit={handleSubmit}
          className="flex-1 min-w-0"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex-shrink-0 h-7 px-2 text-xs"
          disabled={isSending}
          onClick={() => {
            editorRef.current?.submit();
          }}
        >
          {isSending ? <Loader2 className="size-3 animate-spin" /> : "Send"}
        </Button>
      </div>
      {attachDialog}
    </div>
  );
}

/**
 * Hook to expose editor ref to parent components
 * Useful for programmatic control (focus, insert, etc.)
 */
export function useMessageComposerRef() {
  return useRef<MentionEditorHandle>(null);
}

export type { MentionEditorHandle as MessageComposerHandle };
