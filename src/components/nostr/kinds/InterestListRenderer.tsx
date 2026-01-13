import { Sparkles } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { getTagValues } from "@/lib/nostr-utils";
import { getAddressPointerFromATag } from "applesauce-core/helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  HashtagListPreview,
  HashtagListFull,
  EventRefListFull,
} from "../lists";
import type { NostrEvent } from "@/types/nostr";
import type { AddressPointer } from "nostr-tools/nip19";

/**
 * Extract address pointers from a tags (for interest sets references)
 */
function getAddressPointers(event: NostrEvent): AddressPointer[] {
  const pointers: AddressPointer[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "a" && tag[1]) {
      const pointer = getAddressPointerFromATag(tag);
      if (pointer) {
        pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/**
 * Kind 10015 Renderer - Interest List (Feed View)
 * NIP-51 list of topics/hashtags of interest
 */
export function InterestListRenderer({ event }: BaseEventProps) {
  const hashtags = getTagValues(event, "t");
  const interestSets = getAddressPointers(event);

  const totalItems = hashtags.length + interestSets.length;

  if (totalItems === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No interests configured
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-purple-500" />
          <span>Interests</span>
        </div>

        {hashtags.length > 0 && (
          <HashtagListPreview hashtags={hashtags} previewLimit={8} />
        )}

        {interestSets.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>+ {interestSets.length} interest sets</span>
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10015 Detail View - Full interest list
 */
export function InterestListDetailRenderer({ event }: { event: NostrEvent }) {
  const hashtags = getTagValues(event, "t");
  const interestSets = getAddressPointers(event);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-6 text-purple-500" />
        <span className="text-lg font-semibold">Interests</span>
      </div>

      {hashtags.length > 0 && (
        <HashtagListFull hashtags={hashtags} label="Topics" />
      )}

      {interestSets.length > 0 && (
        <EventRefListFull
          addressPointers={interestSets}
          label="Interest Sets"
          icon={<Sparkles className="size-5 text-purple-500" />}
        />
      )}

      {hashtags.length === 0 && interestSets.length === 0 && (
        <div className="text-sm text-muted-foreground italic">
          No interests configured
        </div>
      )}
    </div>
  );
}

/**
 * Kind 30015 Renderer - Interest Set (Feed View)
 * NIP-51 parameterized list of interest topics
 */
export function InterestSetRenderer({ event }: BaseEventProps) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const hashtags = getTagValues(event, "t");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Sparkles className="size-4 text-purple-500" />
          <span>{title}</span>
        </ClickableEventTitle>

        {hashtags.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty interest set
          </div>
        ) : (
          <HashtagListPreview hashtags={hashtags} previewLimit={8} />
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 30015 Detail View - Full interest set
 */
export function InterestSetDetailRenderer({ event }: { event: NostrEvent }) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const description = getTagValue(event, "description");
  const image = getTagValue(event, "image");
  const hashtags = getTagValues(event, "t");

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
          <Sparkles className="size-6 text-purple-500" />
          <span className="text-lg font-semibold">{title}</span>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <HashtagListFull hashtags={hashtags} label="Topics" />
    </div>
  );
}
