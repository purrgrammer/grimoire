import type { NostrEvent } from "@/types/nostr";
import { Hash, MessageCircle, Calendar } from "lucide-react";
import { UserName } from "../UserName";
import { RichText } from "../RichText";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getNip10References } from "applesauce-common/helpers/threading";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import Timestamp from "../Timestamp";

interface ChannelMessageDetailRendererProps {
  event: NostrEvent;
}

/**
 * Kind 42 Detail View - Full channel message with thread context
 * Shows the message with its channel and reply chain
 */
export function ChannelMessageDetailRenderer({
  event,
}: ChannelMessageDetailRendererProps) {
  const { addWindow } = useGrimoire();

  // Parse NIP-10 references
  const references = getNip10References(event);
  const rootPointer = references.root?.e;
  const replyPointer = references.reply?.e;

  // Load channel event (root)
  const channelEvent = useNostrEvent(rootPointer);

  // Load parent message if this is a reply
  const parentMessage =
    replyPointer && replyPointer.id !== rootPointer?.id
      ? useNostrEvent(replyPointer)
      : null;

  const handleOpenChannel = () => {
    if (!channelEvent) return;
    addWindow(
      "open",
      { pointer: { id: channelEvent.id } },
      `#${channelEvent.content || channelEvent.id.slice(0, 8)}`,
    );
  };

  const handleOpenParent = () => {
    if (!parentMessage) return;
    addWindow(
      "open",
      { pointer: { id: parentMessage.id } },
      `Message from ${parentMessage.pubkey.slice(0, 8)}...`,
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto p-4 space-y-4">
      {/* Channel Context */}
      {channelEvent && (
        <div className="space-y-2">
          <Label>Channel</Label>
          <div className="flex items-center justify-between gap-4 p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <Hash className="size-5 text-muted-foreground flex-shrink-0" />
              <span className="font-medium truncate">
                {channelEvent.content || channelEvent.id.slice(0, 8)}
              </span>
            </div>
            <Button
              onClick={handleOpenChannel}
              variant="outline"
              size="sm"
              className="flex-shrink-0"
            >
              View Channel
            </Button>
          </div>
        </div>
      )}

      {/* Parent Message (if reply) */}
      {parentMessage && (
        <div className="space-y-2">
          <Label>Replying to</Label>
          <div className="flex flex-col gap-2 p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <MessageCircle className="size-4 text-muted-foreground" />
              <UserName pubkey={parentMessage.pubkey} className="text-accent" />
              <span className="text-muted-foreground">•</span>
              <Timestamp timestamp={parentMessage.created_at} />
            </div>
            <div className="text-sm text-muted-foreground line-clamp-3">
              <RichText
                event={parentMessage}
                options={{ showMedia: false, showEventEmbeds: false }}
              />
            </div>
            <Button
              onClick={handleOpenParent}
              variant="ghost"
              size="sm"
              className="self-start"
            >
              View Parent
            </Button>
          </div>
        </div>
      )}

      {/* Message Author */}
      <div className="space-y-2">
        <Label>From</Label>
        <div className="flex items-center gap-2">
          <UserName pubkey={event.pubkey} className="text-accent text-base" />
          <span className="text-muted-foreground">•</span>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-3.5" />
            <Timestamp timestamp={event.created_at} format="long" />
          </div>
        </div>
      </div>

      {/* Message Content */}
      <div className="space-y-2">
        <Label>Message</Label>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <RichText event={event} />
        </div>
      </div>
    </div>
  );
}
