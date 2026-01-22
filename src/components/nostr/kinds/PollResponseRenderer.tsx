import { useMemo } from "react";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { Vote } from "lucide-react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./index";
import { EventCardSkeleton } from "@/components/ui/skeleton";
import {
  getPollEventId,
  getPollRelayHint,
  getSelectedOptions,
  getPollOptions,
  getPollType,
} from "@/lib/nip88-helpers";

/**
 * Renderer for Kind 1018 - Poll Response (NIP-88)
 * Displays the vote choice with the poll being voted on
 */
export function PollResponseRenderer({ event }: BaseEventProps) {
  const pollEventId = getPollEventId(event);
  const relayHint = getPollRelayHint(event);
  const selectedOptions = getSelectedOptions(event);

  // Create event pointer for fetching the poll
  const eventPointer = useMemo(() => {
    if (!pollEventId) return undefined;
    return {
      id: pollEventId,
      relays: relayHint ? [relayHint] : undefined,
    };
  }, [pollEventId, relayHint]);

  // Fetch the poll event
  const pollEvent = useNostrEvent(eventPointer);

  // Get poll type from the poll event
  const pollType = pollEvent ? getPollType(pollEvent) : "singlechoice";

  // Map selected option IDs to labels
  const displayedLabels = useMemo(() => {
    const pollOptions = pollEvent ? getPollOptions(pollEvent) : [];
    const labels =
      pollOptions.length === 0
        ? selectedOptions
        : selectedOptions.map((optionId) => {
            const option = pollOptions.find((o) => o.id === optionId);
            return option ? option.label : optionId;
          });

    // For singlechoice polls, only show the first vote
    return pollType === "singlechoice" ? labels.slice(0, 1) : labels;
  }, [selectedOptions, pollEvent, pollType]);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Vote indicator */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Vote className="size-4" />
          <span className="text-sm">
            Voted for:{" "}
            {displayedLabels.length > 0 ? (
              <span className="text-foreground font-medium">
                {displayedLabels.join(", ")}
              </span>
            ) : (
              <span className="italic">unknown option</span>
            )}
          </span>
        </div>

        {/* Embedded poll event (if loaded) */}
        {pollEvent && (
          <div className="border border-muted rounded">
            <KindRenderer event={pollEvent} />
          </div>
        )}

        {/* Loading state */}
        {pollEventId && !pollEvent && (
          <div className="border border-muted rounded p-2">
            <EventCardSkeleton variant="compact" showActions={false} />
          </div>
        )}

        {/* No poll reference */}
        {!pollEventId && (
          <div className="text-xs text-muted-foreground italic">
            Poll reference missing
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
