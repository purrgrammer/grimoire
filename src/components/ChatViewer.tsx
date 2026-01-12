import { useMemo, useState, memo, useCallback, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import { from } from "rxjs";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { Reply, Zap } from "lucide-react";
import { getZapRequest } from "applesauce-common/helpers/zap";
import accountManager from "@/services/accounts";
import eventStore from "@/services/event-store";
import type {
  ChatProtocol,
  ProtocolIdentifier,
  Conversation,
  LiveActivityMetadata,
} from "@/types/chat";
// import { NipC7Adapter } from "@/lib/chat/adapters/nip-c7-adapter";  // Coming soon
import { Nip29Adapter } from "@/lib/chat/adapters/nip-29-adapter";
import { Nip53Adapter } from "@/lib/chat/adapters/nip-53-adapter";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Message } from "@/types/chat";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import Timestamp from "./Timestamp";
import { ReplyPreview } from "./chat/ReplyPreview";
import { MembersDropdown } from "./chat/MembersDropdown";
import { RelaysDropdown } from "./chat/RelaysDropdown";
import { StatusBadge } from "./live/StatusBadge";
import { useGrimoire } from "@/core/state";
import { Button } from "./ui/button";
import {
  MentionEditor,
  type MentionEditorHandle,
  type EmojiTag,
} from "./editor/MentionEditor";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { Label } from "./ui/label";

interface ChatViewerProps {
  protocol: ChatProtocol;
  identifier: ProtocolIdentifier;
  customTitle?: string;
}

/**
 * Helper: Format timestamp as a readable day marker
 */
function formatDayMarker(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Reset time parts for comparison
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const yesterdayOnly = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return "Today";
  } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return "Yesterday";
  } else {
    // Format as "Jan 15" (short month, no year, respects locale)
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
}

/**
 * Helper: Check if two timestamps are on different days
 */
function isDifferentDay(timestamp1: number, timestamp2: number): boolean {
  const date1 = new Date(timestamp1 * 1000);
  const date2 = new Date(timestamp2 * 1000);

  return (
    date1.getFullYear() !== date2.getFullYear() ||
    date1.getMonth() !== date2.getMonth() ||
    date1.getDate() !== date2.getDate()
  );
}

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
      <span className="flex-1 min-w-0 truncate text-muted-foreground">
        {replyEvent.content}
      </span>
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

    return (
      <div className="px-3 py-1">
        <div
          className="rounded-lg p-[1px]"
          style={{
            background:
              "linear-gradient(to right, rgb(250 204 21), rgb(251 146 60), rgb(168 85 247), rgb(34 211 238))",
          }}
        >
          <div className="rounded-lg bg-background px-3 py-1.5">
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
            {message.content && (
              <RichText
                content={message.content}
                event={zapRequest || undefined}
                className="mt-1 text-sm leading-tight break-words"
                options={{ showMedia: false, showEventEmbeds: false }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Regular user messages
  return (
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
}: ChatViewerProps) {
  const { addWindow } = useGrimoire();

  // Get active account
  const activeAccount = use$(accountManager.active$);
  const hasActiveAccount = !!activeAccount;

  // Profile search for mentions
  const { searchProfiles } = useProfileSearch();

  // Emoji search for custom emoji autocomplete
  const { searchEmojis } = useEmojiSearch();

  // Get the appropriate adapter for this protocol
  const adapter = useMemo(() => getAdapter(protocol), [protocol]);

  // Resolve conversation from identifier (async operation)
  const conversation = use$(
    () => from(adapter.resolveConversation(identifier)),
    [adapter, identifier],
  );

  // Load messages for this conversation (reactive)
  const messages = use$(
    () => (conversation ? adapter.loadMessages(conversation) : undefined),
    [adapter, conversation],
  );

  // Process messages to include day markers
  const messagesWithMarkers = useMemo(() => {
    if (!messages || messages.length === 0) return [];

    const items: Array<
      | { type: "message"; data: Message }
      | { type: "day-marker"; data: string; timestamp: number }
    > = [];

    messages.forEach((message, index) => {
      // Add day marker if this is the first message or if day changed
      if (index === 0) {
        items.push({
          type: "day-marker",
          data: formatDayMarker(message.timestamp),
          timestamp: message.timestamp,
        });
      } else {
        const prevMessage = messages[index - 1];
        if (isDifferentDay(prevMessage.timestamp, message.timestamp)) {
          items.push({
            type: "day-marker",
            data: formatDayMarker(message.timestamp),
            timestamp: message.timestamp,
          });
        }
      }

      // Add the message itself
      items.push({ type: "message", data: message });
    });

    return items;
  }, [messages]);

  // Track reply context (which message is being replied to)
  const [replyTo, setReplyTo] = useState<string | undefined>();

  // Ref to Virtuoso for programmatic scrolling
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Ref to MentionEditor for programmatic submission
  const editorRef = useRef<MentionEditorHandle>(null);

  // Handle sending messages
  const handleSend = async (
    content: string,
    replyToId?: string,
    emojiTags?: EmojiTag[],
  ) => {
    if (!conversation || !hasActiveAccount) return;
    await adapter.sendMessage(conversation, content, {
      replyTo: replyToId,
      emojiTags,
    });
    setReplyTo(undefined); // Clear reply context after sending
  };

  // Handle reply button click
  const handleReply = useCallback((messageId: string) => {
    setReplyTo(messageId);
  }, []);

  // Handle scroll to message (when clicking on reply preview)
  const handleScrollToMessage = useCallback(
    (messageId: string) => {
      if (!messages) return;
      const index = messages.findIndex((m) => m.id === messageId);
      if (index !== -1 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index,
          align: "center",
          behavior: "smooth",
        });
      }
    },
    [messages],
  );

  // Handle NIP badge click
  const handleNipClick = useCallback(() => {
    if (conversation?.protocol === "nip-29") {
      addWindow("nip", { number: 29 });
    } else if (conversation?.protocol === "nip-53") {
      addWindow("nip", { number: 53 });
    }
  }, [conversation?.protocol, addWindow]);

  // Get live activity metadata if this is a NIP-53 chat
  const liveActivity = conversation?.metadata?.liveActivity as
    | LiveActivityMetadata
    | undefined;

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

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading conversation...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with conversation info and controls */}
      <div className="px-4 border-b w-full py-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-1 min-w-0 items-center gap-2">
            <div className="flex-1 flex flex-row gap-2 items-center min-w-0">
              <h2 className="text-base font-semibold truncate">
                {customTitle || conversation.title}
              </h2>
              {/* Live activity status badge - small, icon only */}
              {liveActivity?.status && (
                <StatusBadge status={liveActivity.status} size="sm" hideLabel />
              )}
              {/* Show host for live activities */}
              {liveActivity?.hostPubkey && (
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  by{" "}
                  <UserName
                    pubkey={liveActivity.hostPubkey}
                    className="text-xs"
                  />
                </span>
              )}
              {/* Show description for groups */}
              {!liveActivity && conversation.metadata?.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {conversation.metadata.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-1">
            <MembersDropdown participants={derivedParticipants} />
            <RelaysDropdown conversation={conversation} />
            {(conversation.type === "group" ||
              conversation.type === "live-chat") && (
              <button
                onClick={handleNipClick}
                className="rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-muted/80 transition-colors cursor-pointer"
              >
                {conversation.protocol.toUpperCase()}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Message timeline with virtualization */}
      <div className="flex-1 overflow-hidden">
        {messagesWithMarkers && messagesWithMarkers.length > 0 ? (
          <Virtuoso
            ref={virtuosoRef}
            data={messagesWithMarkers}
            initialTopMostItemIndex={messagesWithMarkers.length - 1}
            followOutput="smooth"
            itemContent={(_index, item) => {
              if (item.type === "day-marker") {
                return (
                  <div
                    className="flex justify-center py-2"
                    key={`marker-${item.timestamp}`}
                  >
                    <Label className="text-[10px] text-muted-foreground">
                      {item.data}
                    </Label>
                  </div>
                );
              }
              return (
                <MessageItem
                  key={item.data.id}
                  message={item.data}
                  adapter={adapter}
                  conversation={conversation}
                  onReply={handleReply}
                  canReply={hasActiveAccount}
                  onScrollToMessage={handleScrollToMessage}
                />
              );
            }}
            style={{ height: "100%" }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        )}
      </div>

      {/* Message composer - only show if user has active account */}
      {hasActiveAccount ? (
        <div className="border-t px-2 py-1 pb-0">
          {replyTo && (
            <ComposerReplyPreview
              replyToId={replyTo}
              onClear={() => setReplyTo(undefined)}
            />
          )}
          <div className="flex gap-2 items-center">
            <MentionEditor
              ref={editorRef}
              placeholder="Type a message..."
              searchProfiles={searchProfiles}
              searchEmojis={searchEmojis}
              onSubmit={(content, emojiTags) => {
                if (content.trim()) {
                  handleSend(content, replyTo, emojiTags);
                }
              }}
              className="flex-1 min-w-0"
            />
            <Button
              type="button"
              variant="secondary"
              className="flex-shrink-0 h-[2.5rem]"
              onClick={() => {
                editorRef.current?.submit();
              }}
            >
              Send
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t px-3 py-2 text-center text-sm text-muted-foreground">
          Sign in to send messages
        </div>
      )}
    </div>
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
