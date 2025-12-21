import type { NostrEvent } from "@/types/nostr";
import { useMemo } from "react";
import { Repeat2 } from "lucide-react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { getContentPreview } from "./index";
import { UserName } from "../UserName";
import { RichText } from "../RichText";

/**
 * Compact preview for Kind 6 (Repost)
 * Shows author + content preview of the reposted event
 */
export function RepostCompactPreview({ event }: { event: NostrEvent }) {
  // Get the event being reposted (e tag)
  const eTag = event.tags.find((tag) => tag[0] === "e");
  const repostedEventId = eTag?.[1];
  const repostedRelay = eTag?.[2];

  // Create event pointer for fetching
  const eventPointer = useMemo(() => {
    if (!repostedEventId) return undefined;
    return {
      id: repostedEventId,
      relays: repostedRelay ? [repostedRelay] : undefined,
    };
  }, [repostedEventId, repostedRelay]);

  // Fetch the reposted event
  const repostedEvent = useNostrEvent(eventPointer);

  return (
    <span className="flex items-center gap-1 text-sm text-muted-foreground truncate">
      {repostedEvent ? (
        <>
          <UserName
            pubkey={repostedEvent.pubkey}
            className="text-sm shrink-0"
          />
          <span className="truncate line-clamp-1">
            <RichText
              event={repostedEvent}
              className="inline text-sm leading-none"
              options={{ showMedia: false, showEventEmbeds: false }}
            />
          </span>
        </>
      ) : (
        <span className="truncate opacity-50">Loading...</span>
      )}
    </span>
  );
}
