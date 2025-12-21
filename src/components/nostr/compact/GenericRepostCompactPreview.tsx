import type { NostrEvent } from "@/types/nostr";
import { useMemo } from "react";
import { Repeat2 } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { getContentPreview } from "./index";
import { getKindInfo } from "@/constants/kinds";
import { UserName } from "../UserName";
import { RichText } from "../RichText";

/**
 * Compact preview for Kind 16 (Generic Repost)
 * Shows kind label + content preview of reposted event
 */
export function GenericRepostCompactPreview({ event }: { event: NostrEvent }) {
  // Get the kind of the original event from k tag
  const originalKindStr = getTagValue(event, "k");
  const originalKind = originalKindStr ? parseInt(originalKindStr, 10) : null;

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

  // Get kind name for display
  const kindInfo = originalKind ? getKindInfo(originalKind) : null;
  const kindLabel = kindInfo?.name || (originalKind ? `k${originalKind}` : "");

  // Get content preview
  const preview = repostedEvent ? getContentPreview(repostedEvent, 50) : null;

  return (
    <span className="flex items-center gap-1 text-sm text-muted-foreground truncate">
      <Repeat2 className="size-3 shrink-0" />
      {kindLabel && (
        <span className="shrink-0 text-xs opacity-70">{kindLabel}</span>
      )}
      {repostedEvent ? (
        <>
          <UserName
            pubkey={repostedEvent.pubkey}
            className="text-sm shrink-0"
          />
          <span className="truncate">
            <RichText
              content={preview || ""}
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
