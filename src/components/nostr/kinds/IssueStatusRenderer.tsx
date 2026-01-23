import { CircleDot, CheckCircle2, XCircle, FileEdit } from "lucide-react";
import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { useGrimoire } from "@/core/state";
import {
  getStatusRootEventId,
  getStatusRootRelayHint,
  getStatusLabel,
} from "@/lib/nip34-helpers";
import type { EventPointer } from "nostr-tools/nip19";

/**
 * Get the icon for a status kind
 */
function getStatusIcon(kind: number) {
  switch (kind) {
    case 1630:
      return CircleDot;
    case 1631:
      return CheckCircle2;
    case 1632:
      return XCircle;
    case 1633:
      return FileEdit;
    default:
      return CircleDot;
  }
}

/**
 * Get the color classes for a status kind
 */
function getStatusColorClass(kind: number): string {
  switch (kind) {
    case 1630: // Open
      return "text-green-500";
    case 1631: // Resolved/Merged
      return "text-purple-500";
    case 1632: // Closed
      return "text-red-500";
    case 1633: // Draft
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Renderer for Kind 1630-1633 - Issue/Patch/PR Status Events
 * Displays status action with embedded reference to the issue/patch/PR
 */
export function IssueStatusRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  const rootEventId = getStatusRootEventId(event);
  const relayHint = getStatusRootRelayHint(event);
  const statusLabel = getStatusLabel(event.kind);

  const StatusIcon = getStatusIcon(event.kind);
  const colorClass = getStatusColorClass(event.kind);

  // Build event pointer with relay hint if available
  const eventPointer: EventPointer | undefined = rootEventId
    ? {
        id: rootEventId,
        relays: relayHint ? [relayHint] : undefined,
      }
    : undefined;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Status action header */}
        <div className={`flex items-center gap-2 text-sm ${colorClass}`}>
          <StatusIcon className="size-4" />
          <ClickableEventTitle event={event}>
            <span>{statusLabel}</span>
          </ClickableEventTitle>
        </div>

        {/* Optional comment from the status event */}
        {event.content && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {event.content}
          </p>
        )}

        {/* Embedded referenced issue/patch/PR */}
        {eventPointer && (
          <EmbeddedEvent
            eventPointer={eventPointer}
            onOpen={(id) => {
              addWindow(
                "open",
                { id: id as string },
                `Event ${(id as string).slice(0, 8)}...`,
              );
            }}
            className="border border-muted rounded overflow-hidden"
          />
        )}
      </div>
    </BaseEventContainer>
  );
}

// Export aliases for each status kind
export { IssueStatusRenderer as Kind1630Renderer };
export { IssueStatusRenderer as Kind1631Renderer };
export { IssueStatusRenderer as Kind1632Renderer };
export { IssueStatusRenderer as Kind1633Renderer };
