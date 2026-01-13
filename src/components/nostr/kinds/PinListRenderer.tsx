import { Pin, FileText } from "lucide-react";
import {
  getEventPointerFromETag,
  getAddressPointerFromATag,
} from "applesauce-core/helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { EventRefListFull } from "../lists";
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
 * Kind 10001 Renderer - Pin List (Feed View)
 * NIP-51 list of pinned events
 */
export function PinListRenderer({ event }: BaseEventProps) {
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);

  const totalItems = eventPointers.length + addressPointers.length;

  if (totalItems === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No pinned items
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
          <Pin className="size-4 text-muted-foreground" />
          <span>Pinned</span>
        </ClickableEventTitle>

        <div className="flex items-center gap-1.5 text-xs">
          <FileText className="size-3.5 text-muted-foreground" />
          <span>{totalItems} pinned items</span>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10001 Detail View - Full pin list
 */
export function PinListDetailRenderer({ event }: { event: NostrEvent }) {
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Pin className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Pinned Items</span>
      </div>

      {(eventPointers.length > 0 || addressPointers.length > 0) && (
        <EventRefListFull
          eventPointers={eventPointers}
          addressPointers={addressPointers}
          label="Pinned"
          icon={<FileText className="size-5" />}
        />
      )}

      {eventPointers.length === 0 && addressPointers.length === 0 && (
        <div className="text-sm text-muted-foreground italic">
          No pinned items
        </div>
      )}
    </div>
  );
}
