import { Video, Users } from "lucide-react";
import { getTagValues } from "@/lib/nostr-utils";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { PubkeyListPreview, PubkeyListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 10020 Renderer - Media Follow List (Feed View)
 * NIP-51 list of media creators to follow
 */
export function MediaFollowListRenderer({ event }: BaseEventProps) {
  const pubkeys = getTagValues(event, "p");

  if (pubkeys.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No media creators followed
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Video className="size-4 text-pink-500" />
          <span>Media Follows</span>
        </div>

        <PubkeyListPreview
          pubkeys={pubkeys}
          previewLimit={3}
          label="creators"
          icon={<Users className="size-4 text-muted-foreground" />}
        />
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10020 Detail View - Full media follow list
 */
export function MediaFollowListDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const pubkeys = getTagValues(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Video className="size-6 text-pink-500" />
        <span className="text-lg font-semibold">Media Follows</span>
      </div>

      <PubkeyListFull
        pubkeys={pubkeys}
        label="Creators"
        icon={<Users className="size-5" />}
      />
    </div>
  );
}
