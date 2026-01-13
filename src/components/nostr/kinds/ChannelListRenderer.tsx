import { MessageCircle, Hash } from "lucide-react";
import { getEventPointerFromETag } from "applesauce-core/helpers";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { EventRefListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer } from "nostr-tools/nip19";

/**
 * Extract event pointers from e tags (for channel references)
 * Channels are kind 40 events
 */
function getChannelPointers(event: NostrEvent): EventPointer[] {
  const pointers: EventPointer[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "e" && tag[1]) {
      const pointer = getEventPointerFromETag(tag);
      if (pointer) {
        pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/**
 * Kind 10005 Renderer - Public Chats List (Feed View)
 * NIP-51 list of public chat channels (kind 40)
 * Note: This is different from kind 10009 which is for NIP-29 groups
 */
export function ChannelListRenderer({ event }: BaseEventProps) {
  const channels = getChannelPointers(event);

  if (channels.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">No channels</div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <MessageCircle className="size-4 text-cyan-500" />
          <span>Public Channels</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <Hash className="size-3.5 text-muted-foreground" />
          <span>{channels.length} channels</span>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10005 Detail View - Full channel list
 */
export function ChannelListDetailRenderer({ event }: { event: NostrEvent }) {
  const channels = getChannelPointers(event);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-6 text-cyan-500" />
        <span className="text-lg font-semibold">Public Channels</span>
      </div>

      {channels.length > 0 ? (
        <EventRefListFull
          eventPointers={channels}
          label="Channels"
          icon={<Hash className="size-5" />}
        />
      ) : (
        <div className="text-sm text-muted-foreground italic">No channels</div>
      )}
    </div>
  );
}
