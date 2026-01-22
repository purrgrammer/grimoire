import { Repeat2 } from "lucide-react";
import { getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { useGrimoire } from "@/core/state";

/**
 * Renderer for Kind 6 (Repost) and Kind 16 (Generic Repost)
 * Displays repost indicator with the original event embedded
 *
 * Kind 6: Specifically for reposting kind 1 notes (NIP-18)
 * Kind 16: Generic repost for any event kind (NIP-18)
 */
export function RepostRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Get the event being reposted (e tag) with relay hints
  const eTag = event.tags.find((tag) => tag[0] === "e");
  const repostedEventPointer = eTag ? getEventPointerFromETag(eTag) : null;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Repeat2 className="size-4" />
          <span>reposted</span>
        </div>
        {repostedEventPointer && (
          <EmbeddedEvent
            eventPointer={repostedEventPointer}
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

// Export aliases for backwards compatibility and clarity
export { RepostRenderer as Kind6Renderer };
export { RepostRenderer as Kind16Renderer };
