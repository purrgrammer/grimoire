import { FileText, ExternalLink } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { EmbeddedEvent } from "../EmbeddedEvent";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";

interface EventRefListPreviewProps {
  /** Event pointers (from e tags) */
  eventPointers?: EventPointer[];
  /** Address pointers (from a tags) */
  addressPointers?: AddressPointer[];
  /** Label for the count */
  label?: string;
  /** Icon to show */
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Compact preview of event references
 * Shows count of referenced events/addresses
 */
export function EventRefListPreview({
  eventPointers = [],
  addressPointers = [],
  label = "items",
  icon,
  className,
}: EventRefListPreviewProps) {
  const total = eventPointers.length + addressPointers.length;

  if (total === 0) {
    return (
      <div className={cn("text-xs text-muted-foreground italic", className)}>
        No {label}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5 text-xs", className)}>
      {icon || <FileText className="size-4 text-muted-foreground" />}
      <span>
        {total} {label}
      </span>
    </div>
  );
}

interface EventRefItemProps {
  eventPointer?: EventPointer;
  addressPointer?: AddressPointer;
}

/**
 * Single clickable event reference
 */
export function EventRefItem({
  eventPointer,
  addressPointer,
}: EventRefItemProps) {
  const { addWindow } = useGrimoire();

  const handleClick = () => {
    if (eventPointer) {
      addWindow("open", { pointer: eventPointer });
    } else if (addressPointer) {
      addWindow("open", { pointer: addressPointer });
    }
  };

  const displayText = eventPointer
    ? `${eventPointer.id.slice(0, 8)}...`
    : addressPointer
      ? addressPointer.identifier || `${addressPointer.kind}`
      : "unknown";

  return (
    <div
      className="flex items-center gap-1.5 text-sm cursor-crosshair hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
      onClick={handleClick}
    >
      <ExternalLink className="size-3.5 text-muted-foreground" />
      <span className="text-accent hover:underline hover:decoration-dotted">
        {displayText}
      </span>
    </div>
  );
}

interface EventRefListFullProps {
  /** Event pointers (from e tags) */
  eventPointers?: EventPointer[];
  /** Address pointers (from a tags) */
  addressPointers?: AddressPointer[];
  /** Label for the section header */
  label?: string;
  /** Icon for the header */
  icon?: React.ReactNode;
  /** Show embedded events instead of links */
  embedded?: boolean;
  className?: string;
}

/**
 * Full list of event references for detail views
 * When embedded=true, shows full event renderers for each reference
 */
export function EventRefListFull({
  eventPointers = [],
  addressPointers = [],
  label = "Items",
  icon,
  embedded = true,
  className,
}: EventRefListFullProps) {
  const total = eventPointers.length + addressPointers.length;

  if (total === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground italic", className)}>
        No {label.toLowerCase()}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        {icon || <FileText className="size-5 text-muted-foreground" />}
        <span className="font-semibold">
          {label} ({total})
        </span>
      </div>
      {embedded ? (
        <div className="flex flex-col gap-2">
          {eventPointers.map((pointer) => (
            <EmbeddedEvent
              key={pointer.id}
              eventPointer={pointer}
              className="border border-muted rounded overflow-hidden"
            />
          ))}
          {addressPointers.map((pointer) => (
            <EmbeddedEvent
              key={`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`}
              addressPointer={pointer}
              className="border border-muted rounded overflow-hidden"
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {eventPointers.map((pointer) => (
            <EventRefItem key={pointer.id} eventPointer={pointer} />
          ))}
          {addressPointers.map((pointer) => (
            <EventRefItem
              key={`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`}
              addressPointer={pointer}
            />
          ))}
        </div>
      )}
    </div>
  );
}
