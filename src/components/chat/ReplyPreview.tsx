import { memo, useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { UserName } from "../nostr/UserName";
import { RichText } from "../nostr/RichText";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation } from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";

interface ReplyPreviewProps {
  replyToId: string;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  onScrollToMessage?: (messageId: string) => void;
}

/**
 * ReplyPreview - Shows who is being replied to with truncated message content
 * Automatically fetches missing events from protocol-specific relays
 *
 * For NIP-17 (gift-wrapped DMs), reply targets reference rumor IDs (innermost events).
 * These are stored as synthetic events in adapter caches since eventStore may not
 * properly index events with empty signatures.
 */
export const ReplyPreview = memo(function ReplyPreview({
  replyToId,
  adapter,
  conversation,
  onScrollToMessage,
}: ReplyPreviewProps) {
  // State for manually loaded events (NIP-17 synthetic events)
  const [manualEvent, setManualEvent] = useState<NostrEvent | null>(null);

  // Load the event being replied to (reactive - updates when event arrives)
  const storeEvent = use$(() => eventStore.event(replyToId), [replyToId]);

  // Use store event if available, otherwise fall back to manually loaded event
  const replyEvent = storeEvent ?? manualEvent;

  // Fetch event from adapter if not in store
  useEffect(() => {
    if (!replyEvent) {
      adapter
        .loadReplyMessage(conversation, replyToId)
        .then((event) => {
          if (event) {
            // For NIP-17, eventStore may not track synthetic events properly
            // Store it in local state to ensure it displays
            setManualEvent(event);
          }
        })
        .catch((err) => {
          console.error(
            `[ReplyPreview] Failed to load reply ${replyToId.slice(0, 8)}:`,
            err,
          );
        });
    }
  }, [replyEvent, adapter, conversation, replyToId]);

  const handleClick = () => {
    if (onScrollToMessage) {
      onScrollToMessage(replyToId);
    }
  };

  if (!replyEvent) {
    return (
      <div className="text-xs text-muted-foreground mb-0.5">
        ↳ Replying to {replyToId.slice(0, 8)}...
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
