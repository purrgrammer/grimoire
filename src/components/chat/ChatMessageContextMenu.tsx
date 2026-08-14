import { useState, useMemo } from "react";
import { NostrEvent } from "@/types/nostr";
import type { Conversation, Message } from "@/types/chat";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Copy,
  CopyCheck,
  FileJson,
  ExternalLink,
  Reply,
  MessageSquare,
  Smile,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAddWindow } from "@/core/state";
import { useCopy } from "@/hooks/useCopy";
import { EventJsonDialog } from "@/components/EventJsonDialog";
import { KindBadge } from "@/components/KindBadge";
import { EmojiPickerDialog } from "./EmojiPickerDialog";
import { nip19 } from "nostr-tools";
import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { getEmojiTags } from "@/lib/emoji-helpers";
import type { EmojiTag } from "@/lib/emoji-helpers";

interface ChatMessageContextMenuProps {
  event: NostrEvent;
  children: React.ReactNode;
  onReply?: () => void;
  conversation?: Conversation;
  adapter?: ChatProtocolAdapter;
  /** Message object for protocol-specific actions like zapping */
  message?: Message;
  /** The viewer, for deciding whether this message is theirs to delete. */
  activePubkey?: string;
}

/**
 * Context menu for chat messages
 * Provides right-click/long-press actions for chat messages:
 * - Reply to message
 * - Copy message text
 * - Open event detail
 * - Copy event ID (nevent/naddr)
 * - View raw JSON
 */
export function ChatMessageContextMenu({
  event,
  children,
  onReply,
  conversation,
  adapter,
  message,
  activePubkey,
}: ChatMessageContextMenuProps) {
  const addWindow = useAddWindow();
  const { copy, copied } = useCopy();
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  // Extract context emojis from the conversation
  const contextEmojis = getEmojiTags(event);

  // Get zap configuration from adapter
  const zapConfig = useMemo(() => {
    if (!adapter || !message || !conversation) return null;
    return adapter.getZapConfig(message, conversation);
  }, [adapter, message, conversation]);

  // Self-delete only, and only where the protocol offers one. Deleting someone
  // ELSE's message is moderation — a different capability, and one grimoire does
  // not issue.
  const canDelete = Boolean(
    adapter?.deleteMessage &&
    adapter.getCapabilities().supportsDeletion &&
    activePubkey &&
    event.pubkey === activePubkey,
  );

  const deleteMessage = async () => {
    if (!adapter?.deleteMessage || !conversation) return;
    try {
      await adapter.deleteMessage(conversation, event.id);
      toast.success("Message deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete the message",
      );
    }
  };

  const openEventDetail = () => {
    let pointer;
    // For replaceable/parameterized replaceable events, use AddressPointer
    if (isAddressableKind(event.kind)) {
      // Find d-tag for identifier
      const dTag = getTagValue(event, "d") || "";
      pointer = {
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
      };
    } else {
      // For regular events, use EventPointer
      pointer = {
        id: event.id,
      };
    }

    addWindow("open", { pointer });
  };

  const copyEventId = () => {
    // Get relay hints from where the event has been seen
    const seenRelaysSet = getSeenRelays(event);
    const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

    // For replaceable/parameterized replaceable events, encode as naddr
    if (isAddressableKind(event.kind)) {
      // Find d-tag for identifier
      const dTag = getTagValue(event, "d") || "";
      const naddr = nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
        relays: relays,
      });
      copy(naddr);
    } else {
      // For regular events, encode as nevent
      const nevent = nip19.neventEncode({
        id: event.id,
        author: event.pubkey,
        kind: event.kind,
        relays: relays,
      });
      copy(nevent);
    }
  };

  const copyMessageText = () => {
    copy(event.content);
  };

  const viewEventJson = () => {
    setJsonDialogOpen(true);
  };

  const openReactionPicker = () => {
    setEmojiPickerOpen(true);
  };

  const openZapWindow = () => {
    if (!zapConfig || !zapConfig.supported) return;

    addWindow("zap", {
      recipientPubkey: zapConfig.recipientPubkey,
      eventPointer: zapConfig.eventPointer,
      addressPointer: zapConfig.addressPointer,
      customTags: zapConfig.customTags,
      relays: zapConfig.relays,
    });
  };

  const handleEmojiSelect = async (emoji: string, customEmoji?: EmojiTag) => {
    if (!conversation || !adapter) {
      console.error(
        "[ChatMessageContextMenu] Cannot send reaction: missing conversation or adapter",
      );
      return;
    }

    try {
      await adapter.sendReaction(conversation, event.id, emoji, customEmoji);
    } catch (err) {
      console.error("[ChatMessageContextMenu] Failed to send reaction:", err);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>
            <div className="flex flex-row items-center gap-4">
              <KindBadge kind={event.kind} variant="compact" />
              <KindBadge
                kind={event.kind}
                showName
                showKindNumber
                showIcon={false}
              />
            </div>
          </ContextMenuLabel>
          <ContextMenuSeparator />
          {onReply && (
            <>
              <ContextMenuItem onClick={onReply}>
                <Reply className="size-4 mr-2" />
                Reply
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {conversation && adapter && (
            <>
              <ContextMenuItem onClick={openReactionPicker}>
                <Smile className="size-4 mr-2" />
                React
              </ContextMenuItem>
              {zapConfig?.supported && (
                <ContextMenuItem onClick={openZapWindow}>
                  <Zap className="size-4 mr-2" />
                  Zap
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
            </>
          )}
          {canDelete && (
            <>
              <ContextMenuItem
                onClick={() => void deleteMessage()}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4 mr-2" />
                Delete Message
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={copyMessageText}>
            <MessageSquare className="size-4 mr-2" />
            Copy Text
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={openEventDetail}>
            <ExternalLink className="size-4 mr-2" />
            Open Event
          </ContextMenuItem>
          <ContextMenuItem onClick={copyEventId}>
            {copied ? (
              <CopyCheck className="size-4 mr-2 text-success" />
            ) : (
              <Copy className="size-4 mr-2" />
            )}
            {copied ? "Copied!" : "Copy ID"}
          </ContextMenuItem>
          <ContextMenuItem onClick={viewEventJson}>
            <FileJson className="size-4 mr-2" />
            View JSON
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <EventJsonDialog
        event={event}
        open={jsonDialogOpen}
        onOpenChange={setJsonDialogOpen}
      />
      {conversation && adapter && (
        <EmojiPickerDialog
          open={emojiPickerOpen}
          onOpenChange={setEmojiPickerOpen}
          onEmojiSelect={handleEmojiSelect}
          contextEmojis={contextEmojis}
        />
      )}
    </>
  );
}
