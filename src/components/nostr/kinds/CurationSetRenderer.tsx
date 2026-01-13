import { Library, FileText, Video, Image } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
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

interface CurationSetRendererProps extends BaseEventProps {
  /** Icon to display */
  icon: React.ReactNode;
  /** Color class for the icon */
  iconColor?: string;
  /** Label for the content type */
  contentLabel: string;
}

/**
 * Generic Curation Set Renderer component
 * Used by ArticleCurationSetRenderer, VideoCurationSetRenderer, PictureCurationSetRenderer
 */
function GenericCurationSetRenderer({
  event,
  icon,
  contentLabel,
}: CurationSetRendererProps) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);

  const totalItems = eventPointers.length + addressPointers.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          {icon}
          <span>{title}</span>
        </ClickableEventTitle>

        {totalItems === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty {contentLabel.toLowerCase()} set
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs">
            <FileText className="size-3.5 text-muted-foreground" />
            <span>
              {totalItems} {contentLabel.toLowerCase()}
            </span>
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Generic Curation Set Detail Renderer
 */
function GenericCurationSetDetailRenderer({
  event,
  icon,
  contentLabel,
}: {
  event: NostrEvent;
  icon: React.ReactNode;
  contentLabel: string;
}) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const title = getTagValue(event, "title") || identifier;
  const description = getTagValue(event, "description");
  const image = getTagValue(event, "image");
  const eventPointers = getEventPointers(event);
  const addressPointers = getAddressPointers(event);

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
          {icon}
          <span className="text-lg font-semibold">{title}</span>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <EventRefListFull
        eventPointers={eventPointers}
        addressPointers={addressPointers}
        label={contentLabel}
        icon={<FileText className="size-5" />}
      />
    </div>
  );
}

/**
 * Kind 30004 Renderer - Article Curation Set (Feed View)
 * NIP-51 curated collection of articles
 */
export function ArticleCurationSetRenderer({ event }: BaseEventProps) {
  return (
    <GenericCurationSetRenderer
      event={event}
      icon={<Library className="size-4 text-indigo-500" />}
      contentLabel="Articles"
    />
  );
}

/**
 * Kind 30004 Detail View
 */
export function ArticleCurationSetDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  return (
    <GenericCurationSetDetailRenderer
      event={event}
      icon={<Library className="size-6 text-indigo-500" />}
      contentLabel="Articles"
    />
  );
}

/**
 * Kind 30005 Renderer - Video Curation Set (Feed View)
 * NIP-51 curated collection of videos
 */
export function VideoCurationSetRenderer({ event }: BaseEventProps) {
  return (
    <GenericCurationSetRenderer
      event={event}
      icon={<Video className="size-4 text-red-500" />}
      contentLabel="Videos"
    />
  );
}

/**
 * Kind 30005 Detail View
 */
export function VideoCurationSetDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  return (
    <GenericCurationSetDetailRenderer
      event={event}
      icon={<Video className="size-6 text-red-500" />}
      contentLabel="Videos"
    />
  );
}

/**
 * Kind 30006 Renderer - Picture Curation Set (Feed View)
 * NIP-51 curated collection of pictures
 */
export function PictureCurationSetRenderer({ event }: BaseEventProps) {
  return (
    <GenericCurationSetRenderer
      event={event}
      icon={<Image className="size-4 text-emerald-500" />}
      contentLabel="Pictures"
    />
  );
}

/**
 * Kind 30006 Detail View
 */
export function PictureCurationSetDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  return (
    <GenericCurationSetDetailRenderer
      event={event}
      icon={<Image className="size-6 text-emerald-500" />}
      contentLabel="Pictures"
    />
  );
}
