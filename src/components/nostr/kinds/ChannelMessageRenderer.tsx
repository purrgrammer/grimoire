import { MessageSquare } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { RichText } from "../RichText";

/**
 * Renderer for NIP-28 Channel Messages (kind 42)
 */
export function ChannelMessageRenderer({ event, depth }: BaseEventProps) {
  // Get channel root (first "e" tag marked as root or reply)
  const eTags = event.tags.filter((t) => t[0] === "e");
  const rootTag = eTags.find((t) => t[3] === "root");
  const replyTag = eTags.find((t) => t[3] === "reply");

  const isReply = !!replyTag;

  return (
    <BaseEventContainer event={event}>
      <div className="space-y-2">
        {isReply && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquare className="w-3 h-3" />
            <span>Reply in channel</span>
          </div>
        )}

        <div className="text-sm">
          <RichText content={event.content} event={event} />
        </div>
      </div>
    </BaseEventContainer>
  );
}
