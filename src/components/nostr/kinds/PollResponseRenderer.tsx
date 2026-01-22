import { useMemo } from "react";
import type { EventPointer } from "nostr-tools/nip19";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { Vote } from "lucide-react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { QuotedEvent } from "../QuotedEvent";
import {
  getPollEventId,
  getPollRelayHint,
  getSelectedOptions,
  getPollOptions,
  getPollType,
} from "@/lib/nip88-helpers";

/**
 * Renderer for Kind 1018 - Poll Response (NIP-88)
 * Displays the vote choice with the embedded poll
 */
export function PollResponseRenderer({ event, depth = 0 }: BaseEventProps) {
  const pollEventId = getPollEventId(event);
  const relayHint = getPollRelayHint(event);
  const selectedOptions = getSelectedOptions(event);

  // Create event pointer for the poll
  const pollPointer: EventPointer | undefined = useMemo(() => {
    if (!pollEventId) return undefined;
    return {
      id: pollEventId,
      relays: relayHint ? [relayHint] : undefined,
    };
  }, [pollEventId, relayHint]);

  // Fetch the poll event to resolve option labels
  const pollEvent = useNostrEvent(pollPointer);

  // Get poll type and resolve option IDs to labels
  const pollType = pollEvent ? getPollType(pollEvent) : "singlechoice";

  const displayedLabels = useMemo(() => {
    const pollOptions = pollEvent ? getPollOptions(pollEvent) : [];
    const labels =
      pollOptions.length === 0
        ? selectedOptions // Fall back to raw IDs if poll not loaded
        : selectedOptions.map((optionId) => {
            const option = pollOptions.find((o) => o.id === optionId);
            return option ? option.label : optionId;
          });

    // For singlechoice polls, only show the first vote
    return pollType === "singlechoice" ? labels.slice(0, 1) : labels;
  }, [selectedOptions, pollEvent, pollType]);

  const displayText =
    displayedLabels.length > 0 ? displayedLabels.join(", ") : "unknown option";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Vote indicator */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Vote className="size-4" />
          <span className="text-sm">
            Voted for:{" "}
            {displayedLabels.length > 0 ? (
              <span className="text-foreground font-medium">{displayText}</span>
            ) : (
              <span className="italic">unknown option</span>
            )}
          </span>
        </div>

        {/* Embedded poll using QuotedEvent */}
        {pollPointer && (
          <QuotedEvent eventPointer={pollPointer} depth={depth + 1} />
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
