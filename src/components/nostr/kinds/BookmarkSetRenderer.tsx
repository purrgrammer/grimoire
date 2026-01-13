import { Bookmark, FileText, Link } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { getTagValues } from "@/lib/nostr-utils";
import {
  getEventPointerFromETag,
  getAddressPointerFromATag,
} from "applesauce-core/helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { EventRefListFull, UrlListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";

/**
 * Extract event pointers from e tags
 */
function getEventPointers(event: NostrEvent): EventPointer[] {
  const pointers: EventPointer[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "e" && tag[1]) {
      const pointer = getEventPointerFromETag(tag);
      if (pointer) {
        pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/**
 * Extract address pointers from a tags
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
 * Kind 30003 Renderer - Bookmark Set (Feed View)
 * NIP-51 parameterized list of bookmarks
 * Each set has a unique identifier (d tag) like "read-later", "favorites", etc.
 */
export function BookmarkSetRenderer({ event }: BaseEventProps) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);
  const urls = getTagValues(event, "r");

  const totalItems =
    eventPointers.length + addressPointers.length + urls.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Bookmark className="size-4 text-amber-500" />
          <span>{title}</span>
        </ClickableEventTitle>

        {totalItems === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty bookmark set
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-xs">
            {(eventPointers.length > 0 || addressPointers.length > 0) && (
              <div className="flex items-center gap-1.5">
                <FileText className="size-3.5 text-muted-foreground" />
                <span>
                  {eventPointers.length + addressPointers.length} events
                </span>
              </div>
            )}
            {urls.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Link className="size-3.5 text-muted-foreground" />
                <span>{urls.length} links</span>
              </div>
            )}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 30003 Detail View - Full bookmark set
 */
export function BookmarkSetDetailRenderer({ event }: { event: NostrEvent }) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const description = getTagValue(event, "description");
  const image = getTagValue(event, "image");
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);
  const urls = getTagValues(event, "r");

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
          <Bookmark className="size-6 text-amber-500" />
          <span className="text-lg font-semibold">{title}</span>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {(eventPointers.length > 0 || addressPointers.length > 0) && (
        <EventRefListFull
          eventPointers={eventPointers}
          addressPointers={addressPointers}
          label="Bookmarked Events"
          icon={<FileText className="size-5" />}
        />
      )}

      {urls.length > 0 && <UrlListFull urls={urls} label="Bookmarked Links" />}

      {eventPointers.length === 0 &&
        addressPointers.length === 0 &&
        urls.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            Empty bookmark set
          </div>
        )}
    </div>
  );
}
