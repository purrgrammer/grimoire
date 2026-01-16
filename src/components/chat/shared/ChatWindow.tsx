import { ReactNode } from "react";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import type { MessageListItem, ChatLoadingState } from "./types";
import type {
  EmojiTag,
  BlobAttachment,
} from "@/components/editor/MentionEditor";

interface ChatWindowProps<T extends { id: string; timestamp: number }> {
  /** Loading state for the chat */
  loadingState: ChatLoadingState;
  /** Error message (when loadingState is "error") */
  errorMessage?: string;
  /** Called when user clicks retry after error */
  onRetry?: () => void;

  /** Header content */
  header: ReactNode;
  /** Header prefix (e.g., sidebar toggle) */
  headerPrefix?: ReactNode;
  /** Header suffix (e.g., member count, relay status) */
  headerSuffix?: ReactNode;

  /** Messages to display (with day markers) */
  messages: MessageListItem<T>[];
  /** Render function for messages */
  renderMessage: (
    message: T,
    onScrollToMessage?: (messageId: string) => void,
  ) => ReactNode;
  /** Empty state content */
  emptyState?: ReactNode;

  /** Whether there are more messages to load */
  hasMore?: boolean;
  /** Whether loading older messages is in progress */
  isLoadingMore?: boolean;
  /** Called when user requests to load older messages */
  onLoadMore?: () => void;

  /** Message composer props */
  composer: {
    placeholder?: string;
    isSending: boolean;
    disabled?: boolean;
    disabledMessage?: string;
    replyPreview?: ReactNode;
    onSearchProfiles?: (query: string) => Promise<unknown[]>;
    onSearchEmojis?: (query: string) => Promise<unknown[]>;
    onSearchCommands?: (query: string) => Promise<unknown[]>;
    onCommandExecute?: (command: unknown) => void | Promise<void>;
    onSubmit: (
      content: string,
      emojiTags?: EmojiTag[],
      blobAttachments?: BlobAttachment[],
    ) => void;
    onAttach?: () => void;
    attachDialog?: ReactNode;
  };
}

/**
 * ChatWindow - Generic chat window layout
 * Provides a complete chat interface with header, message list, and composer
 * Protocol-agnostic - works with any chat system
 */
export function ChatWindow<T extends { id: string; timestamp: number }>({
  loadingState,
  errorMessage,
  onRetry,
  header,
  headerPrefix,
  headerSuffix,
  messages,
  renderMessage,
  emptyState,
  hasMore,
  isLoadingMore,
  onLoadMore,
  composer,
}: ChatWindowProps<T>) {
  // Loading state
  if (loadingState === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-xs">Loading conversation...</span>
      </div>
    );
  }

  // Error state with retry
  if (loadingState === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground p-4">
        <AlertTriangle className="size-8 text-destructive" />
        <span className="text-center text-sm">
          {errorMessage || "Failed to load conversation"}
        </span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-2"
          >
            <RefreshCw className="size-3" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  // Success state - show chat interface
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <ChatHeader prefix={headerPrefix} suffix={headerSuffix}>
        {header}
      </ChatHeader>

      {/* Message list */}
      <div className="flex-1 overflow-hidden">
        <MessageList
          items={messages}
          renderMessage={renderMessage}
          hasMore={hasMore}
          isLoading={isLoadingMore}
          onLoadMore={onLoadMore}
          emptyState={emptyState}
        />
      </div>

      {/* Message composer */}
      <MessageComposer {...composer} />
    </div>
  );
}
