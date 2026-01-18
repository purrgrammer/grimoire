import { Hash } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { nip19 } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import type { NostrEvent } from "@/types/nostr";
import { useMemo } from "react";

export interface ChannelLinkProps {
  channelId: string;
  relayHints?: string[];
  className?: string;
  iconClassname?: string;
}

/**
 * ChannelLink - Clickable NIP-28 channel component
 * Displays channel name (from kind 40/41 events) or channel ID
 * Opens chat window on click
 */
export function ChannelLink({
  channelId,
  relayHints = [],
  className,
  iconClassname,
}: ChannelLinkProps) {
  const { addWindow } = useGrimoire();

  // Fetch the kind 40 creation event
  const kind40Event = use$(() => eventStore.event(channelId), [channelId]);

  // Fetch the latest kind 41 metadata for this channel (if kind 40 is loaded)
  const kind41Event = use$(
    () =>
      kind40Event
        ? eventStore.timeline({
            kinds: [41],
            authors: [kind40Event.pubkey],
            "#e": [channelId],
            limit: 1,
          })
        : undefined,
    [channelId, kind40Event?.pubkey],
  )?.[0];

  // Parse metadata from kind 41 or fall back to kind 40 content
  const { channelName, channelIcon } = useMemo(() => {
    if (kind41Event) {
      try {
        const metadata = JSON.parse(kind41Event.content);
        return {
          channelName:
            metadata.name || kind40Event?.content || channelId.slice(0, 8),
          channelIcon: metadata.picture,
        };
      } catch {
        // Invalid JSON, fall back
      }
    }

    return {
      channelName: kind40Event?.content || channelId.slice(0, 8),
      channelIcon: undefined,
    };
  }, [kind41Event, kind40Event, channelId]);

  const handleClick = () => {
    // Create nevent with relay hints if available, otherwise use note
    const identifier =
      relayHints.length > 0
        ? nip19.neventEncode({ id: channelId, relays: relayHints })
        : nip19.noteEncode(channelId);

    addWindow("chat", {
      protocol: "nip-28",
      identifier,
    });
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 cursor-crosshair hover:bg-muted/50 rounded px-1 py-0.5 transition-colors",
        className,
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        {channelIcon ? (
          <img
            src={channelIcon}
            alt=""
            className={cn("size-4 flex-shrink-0 rounded-sm", iconClassname)}
          />
        ) : (
          <Hash
            className={cn(
              "size-4 flex-shrink-0 text-muted-foreground",
              iconClassname,
            )}
          />
        )}
        <span className="text-xs truncate">{channelName}</span>
      </div>
    </div>
  );
}
