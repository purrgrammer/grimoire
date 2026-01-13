import { Package, Users, Video } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { getTagValues } from "@/lib/nostr-utils";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { PubkeyListPreview, PubkeyListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 39089 Renderer - Starter Pack (Feed View)
 * NIP-51 new user onboarding pack with recommended follows
 */
export function StarterPackRenderer({ event }: BaseEventProps) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const pubkeys = getTagValues(event, "p");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Package className="size-4 text-muted-foreground" />
          <span>{title}</span>
        </ClickableEventTitle>

        {pubkeys.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty starter pack
          </div>
        ) : (
          <PubkeyListPreview
            pubkeys={pubkeys}
            previewLimit={5}
            label="recommended follows"
          />
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 39089 Detail View - Full starter pack
 */
export function StarterPackDetailRenderer({ event }: { event: NostrEvent }) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const description = getTagValue(event, "description");
  const image = getTagValue(event, "image");
  const pubkeys = getTagValues(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        {image && (
          <img
            src={image}
            alt={title}
            className="w-full max-w-md h-32 object-cover rounded-lg"
          />
        )}
        <div className="flex items-center gap-2">
          <Package className="size-6 text-muted-foreground" />
          <span className="text-lg font-semibold">{title}</span>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <PubkeyListFull
        pubkeys={pubkeys}
        label="Recommended Follows"
        icon={<Users className="size-5" />}
      />
    </div>
  );
}

/**
 * Kind 39092 Renderer - Media Starter Pack (Feed View)
 * NIP-51 media creator starter pack
 */
export function MediaStarterPackRenderer({ event }: BaseEventProps) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const pubkeys = getTagValues(event, "p");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Video className="size-4 text-muted-foreground" />
          <span>{title}</span>
        </ClickableEventTitle>

        {pubkeys.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty media starter pack
          </div>
        ) : (
          <PubkeyListPreview
            pubkeys={pubkeys}
            previewLimit={5}
            label="media creators"
          />
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 39092 Detail View - Full media starter pack
 */
export function MediaStarterPackDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const description = getTagValue(event, "description");
  const image = getTagValue(event, "image");
  const pubkeys = getTagValues(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        {image && (
          <img
            src={image}
            alt={title}
            className="w-full max-w-md h-32 object-cover rounded-lg"
          />
        )}
        <div className="flex items-center gap-2">
          <Video className="size-6 text-muted-foreground" />
          <span className="text-lg font-semibold">{title}</span>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <PubkeyListFull
        pubkeys={pubkeys}
        label="Media Creators"
        icon={<Users className="size-5" />}
      />
    </div>
  );
}
