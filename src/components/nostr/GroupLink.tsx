import { MessageSquare } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import eventStore from "@/services/event-store";
import { getTagValue } from "applesauce-core/helpers";

/**
 * Format group identifier for display
 * Shows just the group-id part without the relay URL
 */
function formatGroupIdForDisplay(groupId: string): string {
  return groupId;
}

export interface GroupLinkProps {
  groupId: string;
  relayUrl: string;
  className?: string;
  iconClassname?: string;
}

/**
 * GroupLink - Clickable NIP-29 group component
 * Displays group name (from kind 39000 metadata) or group ID
 * Opens chat window on click
 */
export function GroupLink({
  groupId,
  relayUrl,
  className,
  iconClassname,
}: GroupLinkProps) {
  const { addWindow } = useGrimoire();

  // Try to fetch group metadata (kind 39000) from EventStore
  // NIP-29 metadata events use #d tag with group ID
  const groupMetadata = use$(
    () =>
      eventStore
        .timeline([{ kinds: [39000], "#d": [groupId], limit: 1 }])
        .pipe(map((events) => events[0])),
    [groupId],
  );

  // Extract group name from metadata if available
  const groupName =
    groupMetadata && groupMetadata.kind === 39000
      ? getTagValue(groupMetadata, "name") || groupId
      : groupId;

  // Extract group icon if available
  const groupIcon =
    groupMetadata && groupMetadata.kind === 39000
      ? getTagValue(groupMetadata, "picture")
      : undefined;

  const handleClick = () => {
    // Open chat with NIP-29 format: relay'group-id
    const identifier = `${relayUrl}'${groupId}`;
    addWindow("chat", { protocol: "nip-29", identifier });
  };

  const displayName = formatGroupIdForDisplay(groupName);

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
        <span className="text-xs truncate">{displayName}</span>
      </div>
    </div>
  );
}
