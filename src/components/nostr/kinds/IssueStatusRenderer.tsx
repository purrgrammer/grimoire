import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { StatusIndicator } from "../StatusIndicator";
import { MarkdownContent } from "../MarkdownContent";
import { useGrimoire } from "@/core/state";
import {
  getStatusRootEventId,
  getStatusRootRelayHint,
} from "@/lib/nip34-helpers";
import type { EventPointer } from "nostr-tools/nip19";

/**
 * Renderer for Kind 1630-1633 - Issue/Patch/PR Status Events
 * Displays status action with embedded reference to the issue/patch/PR
 */
export function IssueStatusRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  const rootEventId = getStatusRootEventId(event);
  const relayHint = getStatusRootRelayHint(event);

  // Build event pointer with relay hint if available
  const eventPointer: EventPointer | undefined = rootEventId
    ? {
        id: rootEventId,
        relays: relayHint ? [relayHint] : undefined,
      }
    : undefined;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Status action header */}
        <ClickableEventTitle event={event}>
          <StatusIndicator statusKind={event.kind} eventType="issue" />
        </ClickableEventTitle>

        {/* Optional comment from the status event */}
        {event.content && (
          <div className="text-xs text-muted-foreground line-clamp-2">
            <MarkdownContent content={event.content} />
          </div>
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
