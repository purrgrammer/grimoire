import { Settings, Hash } from "lucide-react";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { UserName } from "../UserName";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { getEventPointerFromETag } from "applesauce-core/helpers";

/**
 * Kind 41 Renderer - Channel Metadata (Feed View)
 * NIP-28 channel metadata update event
 */
export function ChannelMetadataRenderer({ event }: BaseEventProps) {
  // Parse metadata from content
  let metadata: {
    name?: string;
    about?: string;
    picture?: string;
    relays?: string[];
  } = {};

  try {
    metadata = JSON.parse(event.content);
  } catch {
    // Invalid JSON, skip metadata parsing
  }

  // Find the channel event (e-tag points to kind 40)
  const channelEventPointer = event.tags
    .filter((t) => t[0] === "e")
    .map((t) => getEventPointerFromETag(t))[0];

  const channelEvent = useNostrEvent(channelEventPointer);

  const channelName =
    metadata.name ||
    channelEvent?.content ||
    (channelEventPointer && typeof channelEventPointer === "object"
      ? channelEventPointer.id.slice(0, 8)
      : "Unknown");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Settings className="size-4" />
          <span>Updated channel</span>
        </div>

        <div className="flex items-center gap-1.5 text-sm">
          <Hash className="size-4 text-muted-foreground" />
          <span className="font-medium">{channelName}</span>
        </div>

        {metadata.about && (
          <div className="text-xs text-muted-foreground line-clamp-2">
            {metadata.about}
          </div>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>by</span>
          <UserName pubkey={event.pubkey} className="text-accent" />
        </div>
      </div>
    </BaseEventContainer>
  );
}
