import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { BaseEventContainer, ClickableEventTitle } from "./BaseEventRenderer";
import { useGrimoire } from "@/core/state";
import { MessageSquare } from "lucide-react";

interface GroupMetadataRendererProps {
  event: NostrEvent;
}

/**
 * Renderer for NIP-29 Group Metadata events (kind 39000)
 * Displays group info and links to chat
 */
export function GroupMetadataRenderer({ event }: GroupMetadataRendererProps) {
  const { addWindow } = useGrimoire();

  // Extract group metadata
  const groupId = getTagValue(event, "d") || "";
  const name = getTagValue(event, "name") || groupId;
  const about = getTagValue(event, "about");
  const picture = getTagValue(event, "picture");

  // Get relay URL from where we saw this event
  const seenRelaysSet = getSeenRelays(event);
  const relayUrl = seenRelaysSet?.values().next().value;

  const handleOpenChat = () => {
    if (!relayUrl) return;

    addWindow("chat", {
      protocol: "nip-29",
      identifier: {
        type: "group",
        value: groupId,
        relays: [relayUrl],
      },
    });
  };

  const canOpenChat = !!relayUrl && !!groupId;

  return (
    <BaseEventContainer event={event}>
      <div className="flex gap-3">
        {/* Group Picture */}
        <div
          className={canOpenChat ? "cursor-crosshair" : ""}
          onClick={canOpenChat ? handleOpenChat : undefined}
        >
          {picture ? (
            <img
              src={picture}
              alt={name}
              className="size-12 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="size-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <MessageSquare className="size-6 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Group Info */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <ClickableEventTitle event={event} className="font-semibold">
            {name}
          </ClickableEventTitle>

          {about && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {about}
            </p>
          )}

          {/* Open Chat Link */}
          {canOpenChat && (
            <button
              onClick={handleOpenChat}
              className="text-xs text-primary hover:underline flex items-center gap-1 w-fit mt-1"
            >
              <MessageSquare className="size-3" />
              Open Chat
            </button>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
