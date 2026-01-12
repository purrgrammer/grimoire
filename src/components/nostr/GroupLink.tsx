import { MessageSquare } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";

/**
 * Format relay URL for display
 * Removes protocol and trailing slash
 */
function formatRelayForDisplay(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

export interface GroupLinkProps {
  groupId: string;
  relayUrl: string;
  metadata?: NostrEvent; // Optional pre-loaded metadata
  className?: string;
  iconClassname?: string;
}

/**
 * GroupLink - Clickable NIP-29 group component
 * Displays group name (from kind 39000 metadata) or group ID
 * Opens chat window on click
 *
 * Special case: "_" group ID represents the unmanaged relay top-level group
 */
export function GroupLink({
  groupId,
  relayUrl,
  metadata,
  className,
  iconClassname,
}: GroupLinkProps) {
  const { addWindow } = useGrimoire();

  // Handle special case: "_" is the unmanaged relay top-level group
  const isUnmanagedGroup = groupId === "_";

  // Extract group name from metadata if available
  let groupName: string;
  if (isUnmanagedGroup) {
    // For "_" groups, show the relay name
    groupName = formatRelayForDisplay(relayUrl);
  } else if (metadata && metadata.kind === 39000) {
    groupName = getTagValue(metadata, "name") || groupId;
  } else {
    groupName = groupId;
  }

  // Extract group icon if available (not applicable for "_" groups)
  const groupIcon =
    !isUnmanagedGroup && metadata && metadata.kind === 39000
      ? getTagValue(metadata, "picture")
      : undefined;

  const handleClick = () => {
    // Open chat with properly structured ProtocolIdentifier
    addWindow("chat", {
      protocol: "nip-29",
      identifier: {
        type: "group",
        value: groupId,
        relays: [relayUrl],
      },
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
        {groupIcon ? (
          <img
            src={groupIcon}
            alt=""
            className={cn("size-4 flex-shrink-0 rounded-sm", iconClassname)}
          />
        ) : (
          <MessageSquare
            className={cn(
              "size-4 flex-shrink-0 text-muted-foreground",
              iconClassname,
            )}
          />
        )}
        <span className="text-xs truncate">{groupName}</span>
      </div>
    </div>
  );
}
