import { useMemo, useState, memo, useCallback, useRef, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { from, catchError, of, map } from "rxjs";
import { Reply, Zap, Copy, CopyCheck } from "lucide-react";
import { nip19 } from "nostr-tools";
import { getZapRequest } from "applesauce-common/helpers/zap";
import { toast } from "sonner";
import accountManager from "@/services/accounts";
import eventStore from "@/services/event-store";
import type {
  ChatProtocol,
  ProtocolIdentifier,
  Conversation,
  LiveActivityMetadata,
} from "@/types/chat";
import { CHAT_KINDS } from "@/types/chat";
// import { NipC7Adapter } from "@/lib/chat/adapters/nip-c7-adapter";  // Coming soon
import { Nip29Adapter } from "@/lib/chat/adapters/nip-29-adapter";
import { Nip53Adapter } from "@/lib/chat/adapters/nip-53-adapter";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Message } from "@/types/chat";
import type { ChatAction } from "@/types/chat-actions";
import { parseSlashCommand } from "@/lib/chat/slash-command-parser";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import Timestamp from "./Timestamp";
import { ReplyPreview } from "./chat/ReplyPreview";
import { MembersDropdown } from "./chat/MembersDropdown";
import { RelaysDropdown } from "./chat/RelaysDropdown";
import { StatusBadge } from "./live/StatusBadge";
import { ChatMessageContextMenu } from "./chat/ChatMessageContextMenu";
import { useGrimoire } from "@/core/state";
import type {
  MentionEditorHandle,
  EmojiTag,
  BlobAttachment,
} from "./editor/MentionEditor";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useCopy } from "@/hooks/useCopy";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import {
  ChatWindow,
  insertDayMarkers,
  type ChatLoadingState,
} from "./chat/shared";

interface ChatViewerProps {
  protocol: ChatProtocol;
  identifier: ProtocolIdentifier;
  customTitle?: string;
  /** Optional content to render before the title (e.g., sidebar toggle on mobile) */
  headerPrefix?: React.ReactNode;
}

/**
 * Type guard for LiveActivityMetadata
 */
function isLiveActivityMetadata(value: unknown): value is LiveActivityMetadata {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.status === "string" &&
    typeof obj.hostPubkey === "string" &&
    Array.isArray(obj.hashtags) &&
    Array.isArray(obj.relays)
  );
}

/**
 * Get the chat command identifier for a conversation
 * Returns a string that can be passed to the `chat` command to open this conversation
 *
 * For NIP-29 groups: relay'group-id (without wss:// prefix)
 * For NIP-53 live activities: naddr1... encoding
 */
function getChatIdentifier(conversation: Conversation): string | null {
  if (conversation.protocol === "nip-29") {
    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;
    if (!groupId || !relayUrl) return null;

    // Strip wss:// or ws:// prefix for cleaner identifier
    const cleanRelay = relayUrl.replace(/^wss?:\/\//, "");
    return `${cleanRelay}'${groupId}`;
  }

  if (conversation.protocol === "nip-53") {
    const activityAddress = conversation.metadata?.activityAddress;
    if (!activityAddress) return null;

    // Get relay hints from live activity metadata
    const liveActivity = conversation.metadata?.liveActivity;
    const relays = liveActivity?.relays || [];

    return nip19.naddrEncode({
      kind: activityAddress.kind,
      pubkey: activityAddress.pubkey,
      identifier: activityAddress.identifier,
      relays: relays.slice(0, 3), // Limit relay hints to keep naddr short
    });
  }

  return null;
}

/**
 * Conversation resolution result - either success with conversation or error
 */
type ConversationResult =
  | { status: "loading" }
  | { status: "success"; conversation: Conversation }
  | { status: "error"; error: string };

/**
 * ComposerReplyPreview - Shows who is being replied to in the composer
 */
const ComposerReplyPreview = memo(function ComposerReplyPreview({
  replyToId,
  onClear,
}: {
  replyToId: string;
  onClear: () => void;
}) {
  const replyEvent = use$(() => eventStore.event(replyToId), [replyToId]);

  if (!replyEvent) {
    return (
      <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-1.5 overflow-hidden">
        <span className="flex-1 min-w-0 truncate">
          Replying to {replyToId.slice(0, 8)}...
        </span>
        <button
          onClick={onClear}
          className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-1.5 overflow-hidden">
      <span className="flex-shrink-0">↳</span>
      <UserName
        pubkey={replyEvent.pubkey}
        className="font-medium flex-shrink-0"
      />
      <div className="flex-1 min-w-0 line-clamp-1 overflow-hidden text-muted-foreground">
        <RichText
          event={replyEvent}
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      </div>
      <button
        onClick={onClear}
        className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
      >
        ✕
      </button>
    </div>
  );
});

/**
 * MessageItem - Memoized message component for performance
 */
const MessageItem = memo(function MessageItem({
  message,
  adapter,
  conversation,
  onReply,
  canReply,
  onScrollToMessage,
}: {
  message: Message;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  onReply?: (messageId: string) => void;
  canReply: boolean;
  onScrollToMessage?: (messageId: string) => void;
}) {
  // System messages (join/leave) have special styling
  if (message.type === "system") {
    return (
      <div className="flex items-center px-3 py-1">
        <span className="text-xs text-muted-foreground">
          * <UserName pubkey={message.author} className="text-xs" />{" "}
          {message.content}
        </span>
      </div>
    );
  }

  // Zap messages have special styling with gradient border
  if (message.type === "zap") {
    const zapRequest = message.event ? getZapRequest(message.event) : null;
    // For NIP-57 zaps, reply target is in the zap request's e-tag
    // For NIP-61 nutzaps, reply target is already in message.replyTo
    const zapReplyTo =
      message.replyTo ||
      zapRequest?.tags.find((t) => t[0] === "e")?.[1] ||
      undefined;

    // Check if the replied-to event exists and is a chat kind
    const replyEvent = use$(
      () => (zapReplyTo ? eventStore.event(zapReplyTo) : undefined),
      [zapReplyTo],
    );

    // Only show reply preview if:
    // 1. The event exists in our store
    // 2. The event is a chat kind (includes messages, nutzaps, live chat, and zap receipts)
    const shouldShowReplyPreview =
      zapReplyTo &&
      replyEvent &&
      (CHAT_KINDS as readonly number[]).includes(replyEvent.kind);

    return (
      <div className="pl-2 my-1">
        <div
          className="p-[1px] rounded"
          style={{
            background:
              "linear-gradient(to right, rgb(250 204 21), rgb(251 146 60), rgb(168 85 247), rgb(34 211 238))",
          }}
        >
          <div className="bg-background px-1 rounded-sm">
            <div className="flex items-center gap-2">
              <UserName
                pubkey={message.author}
                className="font-semibold text-sm"
              />
              <Zap className="size-4 fill-yellow-500 text-yellow-500" />
              <span className="text-yellow-500 font-bold">
                {(message.metadata?.zapAmount || 0).toLocaleString("en", {
                  notation: "compact",
                })}
              </span>
              {message.metadata?.zapRecipient && (
                <UserName
                  pubkey={message.metadata.zapRecipient}
                  className="text-sm"
                />
              )}
              <span className="text-xs text-muted-foreground">
                <Timestamp timestamp={message.timestamp} />
              </span>
            </div>
            {shouldShowReplyPreview && (
              <ReplyPreview
                replyToId={zapReplyTo}
                adapter={adapter}
                conversation={conversation}
                onScrollToMessage={onScrollToMessage}
              />
            )}
            {message.content && (
              <RichText
                event={zapRequest || message.event}
                className="text-sm leading-tight break-words"
                options={{ showMedia: false, showEventEmbeds: false }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Regular user messages - wrap in context menu if event exists
  const messageContent = (
    <div className="group flex items-start hover:bg-muted/50 px-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <UserName pubkey={message.author} className="font-semibold text-sm" />
          <span className="text-xs text-muted-foreground">
            <Timestamp timestamp={message.timestamp} />
          </span>
          {canReply && onReply && (
            <button
              onClick={() => onReply(message.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground ml-auto"
              title="Reply to this message"
            >
              <Reply className="size-3" />
            </button>
          )}
        </div>
        <div className="break-words overflow-hidden">
          {message.event ? (
            <RichText className="text-sm leading-tight" event={message.event}>
              {message.replyTo && (
                <ReplyPreview
                  replyToId={message.replyTo}
                  adapter={adapter}
                  conversation={conversation}
                  onScrollToMessage={onScrollToMessage}
                />
              )}
            </RichText>
          ) : (
            <span className="whitespace-pre-wrap break-words">
              {message.content}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  // Wrap in context menu if event exists
  if (message.event) {
    return (
      <ChatMessageContextMenu
        event={message.event}
        onReply={canReply && onReply ? () => onReply(message.id) : undefined}
      >
        {messageContent}
      </ChatMessageContextMenu>
    );
  }

  return messageContent;
});

/**
 * ChatViewer - Main chat interface component
 *
 * Provides protocol-agnostic chat UI that works across all Nostr messaging protocols.
 * Uses adapter pattern to handle protocol-specific logic while providing consistent UX.
 */
export function ChatViewer({
  protocol,
  identifier,
  customTitle,
  headerPrefix,
}: ChatViewerProps) {
  const { addWindow } = useGrimoire();

  // Get active account
  const activeAccount = use$(accountManager.active$);
  const hasActiveAccount = !!activeAccount;

  // Profile search for mentions
  const { searchProfiles } = useProfileSearch();

  // Emoji search for custom emoji autocomplete
  const { searchEmojis } = useEmojiSearch();

  // Copy chat identifier to clipboard
  const { copy: copyChatId, copied: chatIdCopied } = useCopy();

  // Ref to MentionEditor for programmatic submission
  const editorRef = useRef<MentionEditorHandle>(null);

  // Blossom upload hook for file attachments
  const { open: openUpload, dialog: uploadDialog } = useBlossomUpload({
    accept: "image/*,video/*,audio/*",
    onSuccess: (results) => {
      if (results.length > 0 && editorRef.current) {
        // Insert the first successful upload as a blob attachment with metadata
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

  // Get the appropriate adapter for this protocol
  const adapter = useMemo(() => getAdapter(protocol), [protocol]);

  // State for retry trigger
  const [retryCount, setRetryCount] = useState(0);

  // Resolve conversation from identifier with error handling
  const conversationResult = use$(
    () =>
      from(adapter.resolveConversation(identifier)).pipe(
        map(
          (conv): ConversationResult => ({
            status: "success",
            conversation: conv,
          }),
        ),
        catchError((err) => {
          console.error("[Chat] Failed to resolve conversation:", err);
          const errorMessage =
            err instanceof Error ? err.message : "Failed to load conversation";
          return of<ConversationResult>({
            status: "error",
            error: errorMessage,
          });
        }),
      ),
    [adapter, identifier, retryCount],
  );

  // Extract conversation and loading state from result
  const conversation =
    conversationResult?.status === "success"
      ? conversationResult.conversation
      : null;

  const loadingState: ChatLoadingState = !conversationResult
    ? "loading"
    : conversationResult.status === "error"
      ? "error"
      : "success";

  const errorMessage =
    conversationResult?.status === "error"
      ? conversationResult.error
      : undefined;

  // Slash command search for action autocomplete
  // Context-aware: only shows relevant actions based on membership status
  const searchCommands = useCallback(
    async (query: string) => {
      const availableActions = adapter.getActions({
        conversation: conversation || undefined,
        activePubkey: activeAccount?.pubkey,
      });
      const lowerQuery = query.toLowerCase();
      return availableActions.filter((action) =>
        action.name.toLowerCase().includes(lowerQuery),
      );
    },
    [adapter, conversation, activeAccount],
  );

  // Cleanup subscriptions when conversation changes or component unmounts
  useEffect(() => {
    return () => {
      if (conversation) {
        adapter.cleanup(conversation.id);
      }
    };
  }, [adapter, conversation]);

  // Load messages for this conversation (reactive)
  const messages = use$(
    () => (conversation ? adapter.loadMessages(conversation) : undefined),
    [adapter, conversation],
  );

  // Process messages to include day markers (using generic utility)
  const messagesWithMarkers = useMemo(
    () => insertDayMarkers(messages || []),
    [messages],
  );

  // Track reply context (which message is being replied to)
  const [replyTo, setReplyTo] = useState<string | undefined>();

  // State for loading older messages
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // State for send in progress (prevents double-sends)
  const [isSending, setIsSending] = useState(false);

  // State for tooltip open (for mobile tap support)
  const [tooltipOpen, setTooltipOpen] = useState(false);

  // Handle sending messages with error handling
  const handleSend = async (
    content: string,
    replyToId?: string,
    emojiTags?: EmojiTag[],
    blobAttachments?: BlobAttachment[],
  ) => {
    if (!conversation || !hasActiveAccount || isSending) return;

    // Check if this is a slash command
    const slashCmd = parseSlashCommand(content);
    if (slashCmd) {
      // Execute action instead of sending message
      setIsSending(true);
      try {
        const result = await adapter.executeAction(slashCmd.command, {
          activePubkey: activeAccount.pubkey,
          activeSigner: activeAccount.signer,
          conversation,
        });

        if (result.success) {
          toast.success(result.message || "Action completed");
        } else {
          toast.error(result.message || "Action failed");
        }
      } catch (error) {
        console.error("[Chat] Failed to execute action:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Action failed";
        toast.error(errorMessage);
      } finally {
        setIsSending(false);
      }
      return;
    }

    // Regular message sending
    setIsSending(true);
    try {
      await adapter.sendMessage(conversation, content, {
        replyTo: replyToId,
        emojiTags,
        blobAttachments,
      });
      setReplyTo(undefined); // Clear reply context only on success
    } catch (error) {
      console.error("[Chat] Failed to send message:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send message";
      toast.error(errorMessage);
      // Don't clear replyTo so user can retry
    } finally {
      setIsSending(false);
    }
  };

  // Handle command execution from autocomplete
  const handleCommandExecute = useCallback(
    async (action: ChatAction) => {
      if (!conversation || !hasActiveAccount || isSending) return;

      setIsSending(true);
      try {
        const result = await adapter.executeAction(action.name, {
          activePubkey: activeAccount.pubkey,
          activeSigner: activeAccount.signer,
          conversation,
        });

        if (result.success) {
          toast.success(result.message || "Action completed");
        } else {
          toast.error(result.message || "Action failed");
        }
      } catch (error) {
        console.error("[Chat] Failed to execute action:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Action failed";
        toast.error(errorMessage);
      } finally {
        setIsSending(false);
      }
    },
    [conversation, hasActiveAccount, isSending, adapter, activeAccount],
  );

  // Handle reply button click
  const handleReply = useCallback((messageId: string) => {
    setReplyTo(messageId);
    // Focus the editor so user can start typing immediately
    editorRef.current?.focus();
  }, []);

  // Handle loading older messages
  const handleLoadOlder = useCallback(async () => {
    if (!conversation || !messages || messages.length === 0 || isLoadingOlder) {
      return;
    }

    setIsLoadingOlder(true);
    try {
      // Get the timestamp of the oldest message
      const oldestMessage = messages[0];
      const olderMessages = await adapter.loadMoreMessages(
        conversation,
        oldestMessage.timestamp,
      );

      // If we got fewer messages than expected, there might be no more
      if (olderMessages.length < 50) {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to load older messages:", error);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [conversation, messages, adapter, isLoadingOlder]);

  // Handle NIP badge click
  const handleNipClick = useCallback(() => {
    if (conversation?.protocol === "nip-29") {
      addWindow("nip", { number: 29 });
    } else if (conversation?.protocol === "nip-53") {
      addWindow("nip", { number: 53 });
    }
  }, [conversation?.protocol, addWindow]);

  // Get live activity metadata if this is a NIP-53 chat (with type guard)
  const liveActivity = isLiveActivityMetadata(
    conversation?.metadata?.liveActivity,
  )
    ? conversation?.metadata?.liveActivity
    : undefined;

  // Derive participants from messages for live activities (unique pubkeys who have chatted)
  const derivedParticipants = useMemo(() => {
    if (conversation?.type !== "live-chat" || !messages) {
      return conversation?.participants || [];
    }

    const hostPubkey = liveActivity?.hostPubkey;
    const participants: { pubkey: string; role: "host" | "member" }[] = [];

    // Host always first
    if (hostPubkey) {
      participants.push({ pubkey: hostPubkey, role: "host" });
    }

    // Add other participants from messages (excluding host)
    const seen = new Set(hostPubkey ? [hostPubkey] : []);
    for (const msg of messages) {
      if (msg.type !== "system" && !seen.has(msg.author)) {
        seen.add(msg.author);
        participants.push({ pubkey: msg.author, role: "member" });
      }
    }

    return participants;
  }, [
    conversation?.type,
    conversation?.participants,
    messages,
    liveActivity?.hostPubkey,
  ]);

  // Render function for messages (Nostr-specific)
  const renderMessage = useCallback(
    (message: Message, onScrollToMessage?: (messageId: string) => void) => (
      <MessageItem
        key={message.id}
        message={message}
        adapter={adapter}
        conversation={conversation!}
        onReply={handleReply}
        canReply={hasActiveAccount}
        onScrollToMessage={onScrollToMessage}
      />
    ),
    [adapter, conversation, handleReply, hasActiveAccount],
  );

  // Header content (Nostr-specific)
  const headerContent = conversation && (
    <>
      <TooltipProvider>
        <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild>
            <button
              className="text-sm font-semibold truncate cursor-help text-left"
              onClick={() => setTooltipOpen(!tooltipOpen)}
            >
              {customTitle || conversation.title}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-md p-3">
            <div className="flex flex-col gap-2">
              {/* Icon + Name */}
              <div className="flex items-center gap-2">
                {conversation.metadata?.icon && (
                  <img
                    src={conversation.metadata.icon}
                    alt=""
                    className="size-6 rounded object-cover flex-shrink-0"
                    onError={(e) => {
                      // Hide image if it fails to load
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <span className="font-semibold">{conversation.title}</span>
              </div>
              {/* Description */}
              {conversation.metadata?.description && (
                <p className="text-xs text-primary-foreground/90">
                  {conversation.metadata.description}
                </p>
              )}
              {/* Protocol Type - Clickable */}
              <div className="flex items-center gap-1.5 text-xs">
                {(conversation.type === "group" ||
                  conversation.type === "live-chat") && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNipClick();
                    }}
                    className="rounded bg-primary-foreground/20 px-1.5 py-0.5 font-mono hover:bg-primary-foreground/30 transition-colors cursor-pointer text-primary-foreground"
                  >
                    {conversation.protocol.toUpperCase()}
                  </button>
                )}
                {(conversation.type === "group" ||
                  conversation.type === "live-chat") && (
                  <span className="text-primary-foreground/60">•</span>
                )}
                <span className="capitalize text-primary-foreground/80">
                  {conversation.type}
                </span>
              </div>
              {/* Live Activity Status */}
              {liveActivity?.status && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-primary-foreground/80">Status:</span>
                  <StatusBadge status={liveActivity.status} size="xs" />
                </div>
              )}
              {/* Host Info */}
              {liveActivity?.hostPubkey && (
                <div className="flex items-center gap-1.5 text-xs text-primary-foreground/80">
                  <span>Host:</span>
                  <UserName
                    pubkey={liveActivity.hostPubkey}
                    className="text-xs text-primary-foreground"
                  />
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {/* Copy Chat ID button */}
      {getChatIdentifier(conversation) && (
        <button
          onClick={() => {
            const chatId = getChatIdentifier(conversation);
            if (chatId) copyChatId(chatId);
          }}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label="Copy chat ID"
        >
          {chatIdCopied ? (
            <CopyCheck className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      )}
    </>
  );

  // Header suffix (Nostr-specific controls)
  const headerSuffix = conversation && (
    <>
      <MembersDropdown participants={derivedParticipants} />
      <RelaysDropdown conversation={conversation} />
      {(conversation.type === "group" || conversation.type === "live-chat") && (
        <button
          onClick={handleNipClick}
          className="rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-muted/80 transition-colors cursor-pointer"
        >
          {conversation.protocol.toUpperCase()}
        </button>
      )}
    </>
  );

  // Reply preview for composer
  const replyPreview = replyTo ? (
    <ComposerReplyPreview
      replyToId={replyTo}
      onClear={() => setReplyTo(undefined)}
    />
  ) : undefined;

  return (
    <ChatWindow
      loadingState={loadingState}
      errorMessage={errorMessage}
      onRetry={() => setRetryCount((c) => c + 1)}
      header={headerContent}
      headerPrefix={headerPrefix}
      headerSuffix={headerSuffix}
      messages={messagesWithMarkers}
      renderMessage={renderMessage}
      emptyState="No messages yet. Start the conversation!"
      hasMore={hasMore}
      isLoadingMore={isLoadingOlder}
      onLoadMore={handleLoadOlder}
      composer={{
        placeholder: "Type a message...",
        isSending,
        disabled: !hasActiveAccount,
        disabledMessage: "Sign in to send messages",
        replyPreview,
        onSearchProfiles: searchProfiles as (
          query: string,
        ) => Promise<unknown[]>,
        onSearchEmojis: searchEmojis as (query: string) => Promise<unknown[]>,
        onSearchCommands: searchCommands as (
          query: string,
        ) => Promise<unknown[]>,
        onCommandExecute: handleCommandExecute as (
          command: unknown,
        ) => Promise<void>,
        onSubmit: (content, emojiTags, blobAttachments) => {
          if (content.trim()) {
            handleSend(content, replyTo, emojiTags, blobAttachments);
          }
        },
        onAttach: openUpload,
        attachDialog: uploadDialog,
      }}
    />
  );
}

/**
 * Get the appropriate adapter for a protocol
 * Currently NIP-29 (relay-based groups) and NIP-53 (live activity chat) are supported
 * Other protocols will be enabled in future phases
 */
function getAdapter(protocol: ChatProtocol): ChatProtocolAdapter {
  switch (protocol) {
    // case "nip-c7":  // Phase 1 - Simple chat (coming soon)
    //   return new NipC7Adapter();
    case "nip-29":
      return new Nip29Adapter();
    // case "nip-17":  // Phase 2 - Encrypted DMs (coming soon)
    //   return new Nip17Adapter();
    // case "nip-28":  // Phase 3 - Public channels (coming soon)
    //   return new Nip28Adapter();
    case "nip-53":
      return new Nip53Adapter();
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
}
