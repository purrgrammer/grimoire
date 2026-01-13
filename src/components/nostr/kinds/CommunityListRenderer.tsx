import { Users2, Globe } from "lucide-react";
import { getAddressPointerFromATag } from "applesauce-core/helpers";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { EventRefListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";
import type { AddressPointer } from "nostr-tools/nip19";

/**
 * Extract address pointers from a tags (for community references)
 * Communities are kind 34550 events
 */
function getCommunityPointers(event: NostrEvent): AddressPointer[] {
  const pointers: AddressPointer[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "a" && tag[1]) {
      const pointer = getAddressPointerFromATag(tag);
      // Only include kind 34550 (community definitions)
      if (pointer && pointer.kind === 34550) {
        pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/**
 * Kind 10004 Renderer - Community List (Feed View)
 * NIP-51 list of communities the user is part of
 */
export function CommunityListRenderer({ event }: BaseEventProps) {
  const communities = getCommunityPointers(event);

  if (communities.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No communities
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Users2 className="size-4 text-green-500" />
          <span>Communities</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <Globe className="size-3.5 text-muted-foreground" />
          <span>{communities.length} communities</span>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10004 Detail View - Full community list
 */
export function CommunityListDetailRenderer({ event }: { event: NostrEvent }) {
  const communities = getCommunityPointers(event);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Users2 className="size-6 text-green-500" />
        <span className="text-lg font-semibold">Communities</span>
      </div>

      {communities.length > 0 ? (
        <EventRefListFull
          addressPointers={communities}
          label="Member Of"
          icon={<Globe className="size-5" />}
        />
      ) : (
        <div className="text-sm text-muted-foreground italic">
          No communities
        </div>
      )}
    </div>
  );
}
