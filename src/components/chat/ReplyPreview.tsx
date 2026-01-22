import { memo, useEffect, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import eventStore from "@/services/event-store";
import { UserName } from "../nostr/UserName";
import { RichText } from "../nostr/RichText";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation } from "@/types/chat";

interface ReplyPreviewProps {
  replyTo: EventPointer | AddressPointer;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  onScrollToMessage?: (messageId: string) => void;
}

/**
 * ReplyPreview - Shows who is being replied to with truncated message content
 * Automatically fetches missing events from protocol-specific relays using relay hints
 */
export const ReplyPreview = memo(function ReplyPreview({
  replyTo,
  adapter,
  conversation,
  onScrollToMessage,
}: ReplyPreviewProps) {
  // Extract event ID from pointer (EventPointer has 'id', AddressPointer doesn't)
  const eventId = useMemo(() => {
    return "id" in replyTo ? replyTo.id : null;
  }, [replyTo]);

  // Load the event being replied to (reactive - updates when event arrives)
  const replyEvent = use$(
    () => (eventId ? eventStore.event(eventId) : undefined),
    [eventId],
  );

  // Fetch event from relays if not in store
  useEffect(() => {
    if (!replyEvent && eventId) {
      adapter.loadReplyMessage(conversation, replyTo).catch((err) => {
        console.error(
          `[ReplyPreview] Failed to load reply ${eventId.slice(0, 8)}:`,
          err,
        );
      });
    }
  }, [replyEvent, adapter, conversation, replyTo, eventId]);

  const handleClick = () => {
    if (onScrollToMessage && eventId) {
      onScrollToMessage(eventId);
    }
  };

  if (!eventId) {
    // AddressPointer - show a minimal indicator
    return (
      <div className="text-xs text-muted-foreground mb-0.5">
        ↳ Replying to event...
      </div>
    );
  }

  if (!replyEvent) {
    return (
      <div className="text-xs text-muted-foreground mb-0.5">
        ↳ Replying to {eventId.slice(0, 8)}...
      </div>
    );
  }

  return (
    <div
      className="text-xs text-muted-foreground flex items-baseline gap-1 mb-0.5 overflow-hidden cursor-pointer hover:text-foreground transition-colors"
      onClick={handleClick}
      title="Click to scroll to message"
    >
      <span className="flex-shrink-0">↳</span>
      <UserName
        pubkey={replyEvent.pubkey}
        className="font-medium flex-shrink-0"
      />
      <div className="line-clamp-1 overflow-hidden flex-1 min-w-0">
        <RichText
          event={replyEvent}
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      </div>
    </div>
  );
});
