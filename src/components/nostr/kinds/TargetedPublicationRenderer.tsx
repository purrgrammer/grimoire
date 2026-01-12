import { Target, Users } from "lucide-react";
import { BaseEventContainer, BaseEventProps } from "./BaseEventRenderer";
import { KindRenderer } from "./index";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  getTargetedPublicationEventId,
  getTargetedPublicationAddress,
  getTargetedPublicationKind,
  getTargetedCommunityPubkeys,
} from "@/lib/communikeys-helpers";
import { parseAddressPointer } from "@/lib/nip89-helpers";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Renderer for Kind 30222 - Targeted Publication
 * Displays the original publication with badges for targeted communities
 */
export function TargetedPublicationRenderer({
  event,
  depth = 0,
}: BaseEventProps) {
  // Get the original publication reference
  const eventId = getTargetedPublicationEventId(event);
  const eventAddress = getTargetedPublicationAddress(event);
  const publicationKind = getTargetedPublicationKind(event);

  // Build pointer for the original event
  let pointer: Parameters<typeof useNostrEvent>[0] = undefined;
  if (eventId) {
    pointer = { id: eventId };
  } else if (eventAddress) {
    const parsed = parseAddressPointer(eventAddress);
    if (parsed) {
      pointer = {
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.identifier,
      };
    }
  }

  // Fetch the original publication
  const originalEvent = useNostrEvent(pointer, event);

  // Get targeted communities
  const communityPubkeys = getTargetedCommunityPubkeys(event);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Header with target icon and communities */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Target className="size-4" />
          <span>Targeted to:</span>
          <div className="flex flex-wrap gap-1">
            {communityPubkeys.slice(0, 5).map((pubkey) => (
              <CommunityBadge key={pubkey} pubkey={pubkey} />
            ))}
            {communityPubkeys.length > 5 && (
              <Badge variant="outline" className="text-xs">
                +{communityPubkeys.length - 5} more
              </Badge>
            )}
          </div>
        </div>

        {/* Original publication */}
        {originalEvent ? (
          <div className="border-l-2 border-muted pl-3 -ml-1">
            <KindRenderer event={originalEvent} depth={depth + 1} />
          </div>
        ) : pointer ? (
          <div className="border-l-2 border-muted pl-3 -ml-1 py-2">
            <Skeleton className="h-20 w-full" />
            <p className="text-xs text-muted-foreground mt-2">
              Loading original publication
              {publicationKind && ` (kind ${publicationKind})`}...
            </p>
          </div>
        ) : (
          <div className="border-l-2 border-muted pl-3 -ml-1 py-2 text-sm text-muted-foreground">
            Original publication reference not found
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Badge component showing a community with its name
 */
function CommunityBadge({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <Users className="size-3" />
      {displayName}
    </Badge>
  );
}
