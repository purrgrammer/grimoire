import { useMemo } from "react";
import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getDisplayName } from "@/lib/nostr-utils";
import { useProfile } from "@/hooks/useProfile";
import { Video } from "lucide-react";
import { useGrimoire } from "@/core/state";

/**
 * Renderer for Kind 1311 - Live Chat Message (NIP-53)
 * Displays live chat messages from live streaming events with rich text formatting
 * and a link to the original live activity
 */
export function LiveChatMessageRenderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Get the 'a' tag pointing to the live activity (kind 30311)
  const aTag = event.tags.find((tag) => tag[0] === "a");
  const activityAddress = aTag?.[1]; // Format: kind:pubkey:d-tag

  // Parse the address pointer
  const addressPointer = useMemo(
    () => (activityAddress ? parseReplaceableAddress(activityAddress) : null),
    [activityAddress],
  );

  // Fetch the live activity event
  const liveActivity = useNostrEvent(
    addressPointer
      ? {
          kind: addressPointer.kind,
          pubkey: addressPointer.pubkey,
          identifier: addressPointer.identifier || "",
          relays: [],
        }
      : undefined,
  );

  // Get host profile for display name
  const hostProfile = useProfile(addressPointer?.pubkey);
  const hostName = hostProfile
    ? getDisplayName(addressPointer!.pubkey, hostProfile)
    : addressPointer?.pubkey.slice(0, 8);

  // Get live activity title from tags
  const activityTitle = liveActivity?.tags.find((t) => t[0] === "title")?.[1];

  const handleActivityClick = () => {
    if (!addressPointer) return;
    addWindow(
      "open",
      {
        pointer: {
          kind: addressPointer.kind,
          pubkey: addressPointer.pubkey,
          identifier: addressPointer.identifier || "",
        },
      },
      activityTitle || "Live Activity",
    );
  };

  return (
    <BaseEventContainer event={event}>
      {/* Link to original live activity */}
      {addressPointer && (
        <button
          onClick={handleActivityClick}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1 cursor-crosshair"
        >
          <Video className="size-3" />
          <span className="truncate">
            {activityTitle || `Live chat with ${hostName}`}
          </span>
        </button>
      )}

      {/* Message content with rich text */}
      <RichText event={event} className="text-sm" depth={depth} />
    </BaseEventContainer>
  );
}

// Export with human-readable name as primary
export { LiveChatMessageRenderer as Kind1311Renderer };
