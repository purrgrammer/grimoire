import { Repeat2 } from "lucide-react";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { useGrimoire } from "@/core/state";

/**
 * Renderer for Kind 6 - Reposts
 * Displays repost indicator with the original event embedded
 */
export function Kind6Renderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Get the event being reposted (e tag)
  const eTag = event.tags.find((tag) => tag[0] === "e");
  const repostedEventId = eTag?.[1];

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Repeat2 className="size-4" />
          <span>reposted</span>
        </div>
        {repostedEventId && (
          <EmbeddedEvent
            eventId={repostedEventId}
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
