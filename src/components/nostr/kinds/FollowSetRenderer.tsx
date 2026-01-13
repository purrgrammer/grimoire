import { Users } from "lucide-react";
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
 * Kind 30000 Renderer - Follow Set (Feed View)
 * NIP-51 parameterized list of pubkeys to follow
 * Each set has a unique identifier (d tag) like "friends", "work", etc.
 */
export function FollowSetRenderer({ event }: BaseEventProps) {
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
          <Users className="size-4 text-accent" />
          <span>{title}</span>
        </ClickableEventTitle>

        {pubkeys.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty follow set
          </div>
        ) : (
          <PubkeyListPreview
            pubkeys={pubkeys}
            previewLimit={3}
            label="people"
          />
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 30000 Detail View - Full follow set
 */
export function FollowSetDetailRenderer({ event }: { event: NostrEvent }) {
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
          <Users className="size-6 text-accent" />
          <span className="text-lg font-semibold">{title}</span>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <PubkeyListFull pubkeys={pubkeys} label="People" />
    </div>
  );
}
