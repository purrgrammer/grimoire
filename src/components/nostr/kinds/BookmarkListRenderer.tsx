import { Bookmark, FileText, Link } from "lucide-react";
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
 * Kind 10003 Renderer - Bookmark List (Feed View)
 * NIP-51 list of bookmarked events, addresses, and URLs
 */
export function BookmarkListRenderer({ event }: BaseEventProps) {
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);
  const urls = getTagValues(event, "r");

  const totalItems =
    eventPointers.length + addressPointers.length + urls.length;

  if (totalItems === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Empty bookmark list
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Bookmark className="size-4 text-muted-foreground" />
          <span>Bookmarks</span>
        </ClickableEventTitle>

        <div className="flex flex-col gap-1.5 text-xs">
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
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10003 Detail View - Full bookmark list
 */
export function BookmarkListDetailRenderer({ event }: { event: NostrEvent }) {
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);
  const urls = getTagValues(event, "r");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Bookmark className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Bookmarks</span>
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
            Empty bookmark list
          </div>
        )}
    </div>
  );
}
