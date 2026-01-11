import { useMemo, useState, memo, useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { from } from "rxjs";
import { Virtuoso } from "react-virtuoso";
import type {
  ChatProtocol,
  ProtocolIdentifier,
  Conversation,
} from "@/types/chat";
import { NipC7Adapter } from "@/lib/chat/adapters/nip-c7-adapter";
import { Nip29Adapter } from "@/lib/chat/adapters/nip-29-adapter";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Message } from "@/types/chat";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import Timestamp from "./Timestamp";
import { ReplyPreview } from "./chat/ReplyPreview";
import { MembersDropdown } from "./chat/MembersDropdown";
import { RelaysDropdown } from "./chat/RelaysDropdown";
import { useGrimoire } from "@/core/state";
import { Button } from "./ui/button";

interface ChatViewerProps {
  protocol: ChatProtocol;
  identifier: ProtocolIdentifier;
  customTitle?: string;
}

/**
 * MessageItem - Memoized message component for performance
 */
const MessageItem = memo(function MessageItem({
  message,
  adapter,
  conversation,
}: {
  message: Message;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
}) {
  return (
    <div className="group flex items-start hover:bg-muted/50 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <UserName pubkey={message.author} className="font-semibold text-sm" />
          <span className="text-xs text-muted-foreground">
            <Timestamp timestamp={message.timestamp} />
          </span>
        </div>
        <div className="text-sm leading-relaxed break-words overflow-hidden">
          {message.event ? (
            <RichText event={message.event}>
              {message.replyTo && (
                <ReplyPreview
                  replyToId={message.replyTo}
                  adapter={adapter}
                  conversation={conversation}
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

  // Track reply context (which message is being replied to)
  const [replyTo, setReplyTo] = useState<string | undefined>();

  // Handle sending messages
  const handleSend = async (content: string, replyToId?: string) => {
    if (!conversation) return;
    await adapter.sendMessage(conversation, content, replyToId);
    setReplyTo(undefined); // Clear reply context after sending
  };

  // Handle NIP badge click
  const handleNipClick = useCallback(() => {
    if (conversation?.protocol === "nip-29") {
      addWindow("nip", { number: 29 });
    }
  }, [conversation?.protocol, addWindow]);

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
            <div className="flex-1 flex flex-row gap-2 items-baseline min-w-0">
              <h2 className="truncate text-base font-semibold">
                {customTitle || conversation.title}
              </h2>
              {conversation.metadata?.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {conversation.metadata.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-1">
            <MembersDropdown participants={conversation.participants} />
            <RelaysDropdown conversation={conversation} />
            {conversation.type === "group" && (
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
        {messages && messages.length > 0 ? (
          <Virtuoso
            data={messages}
            initialTopMostItemIndex={messages.length - 1}
            followOutput="smooth"
            itemContent={(_index, message) => (
              <MessageItem
                key={message.id}
                message={message}
                adapter={adapter}
                conversation={conversation}
              />
            )}
            style={{ height: "100%" }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        )}
      </div>

      {/* Message composer */}
      <div className="border-t px-3 py-2">
        {replyTo && (
          <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-2">
            <span>Replying to {replyTo.slice(0, 8)}...</span>
            <button
              onClick={() => setReplyTo(undefined)}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const input = form.elements.namedItem(
              "message",
            ) as HTMLTextAreaElement;
            if (input.value.trim()) {
              handleSend(input.value, replyTo);
              input.value = "";
            }
          }}
          className="flex gap-2"
        >
          <textarea
            name="message"
            autoFocus
            placeholder="Type a message..."
            className="flex-1 resize-none bg-background px-3 py-2 text-sm border rounded-md min-w-0"
            rows={1}
            onKeyDown={(e) => {
              // Submit on Enter (without Shift)
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" variant="secondary" className="flex-shrink-0">
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Get the appropriate adapter for a protocol
 * TODO: Add other adapters as they're implemented
 */
function getAdapter(protocol: ChatProtocol): ChatProtocolAdapter {
  switch (protocol) {
    case "nip-c7":
      return new NipC7Adapter();
    case "nip-29":
      return new Nip29Adapter();
    // case "nip-17":
    //   return new Nip17Adapter();
    // case "nip-28":
    //   return new Nip28Adapter();
    // case "nip-53":
    //   return new Nip53Adapter();
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
}
