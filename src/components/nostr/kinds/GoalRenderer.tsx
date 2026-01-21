import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { Zap } from "lucide-react";
import { useGoalProgress } from "@/hooks/useGoalProgress";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

/**
 * Renderer for Kind 9041 - Zap Goals (NIP-75)
 * Shows goal title, description, and funding progress
 */
export function GoalRenderer({ event }: BaseEventProps) {
  const { locale, addWindow } = useGrimoire();
  const {
    title,
    summary,
    closedAt,
    closed,
    targetSats,
    raisedSats,
    progress,
    loading,
    zaps,
  } = useGoalProgress(event);

  const deadlineText = closedAt
    ? formatTimestamp(closedAt, "absolute", locale.locale)
    : null;

  const handleZap = () => {
    addWindow("zap", {
      recipientPubkey: event.pubkey,
      eventPointer: { id: event.id },
    });
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold text-foreground leading-tight"
        >
          {title}
        </ClickableEventTitle>

        {/* Description (summary tag only) */}
        {summary && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {summary}
          </p>
        )}

        {/* Progress */}
        {targetSats > 0 && (
          <div className="flex flex-col gap-1.5">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">
                {loading && zaps.length === 0 ? (
                  "Loading..."
                ) : (
                  <>
                    <span className="text-foreground font-medium">
                      {raisedSats.toLocaleString()}
                    </span>
                    {" / "}
                    {targetSats.toLocaleString()}
                  </>
                )}
              </span>
              <span className="text-muted-foreground">
                {progress.toFixed(0)}%
              </span>
            </div>
          </div>
        )}

        {/* Deadline */}
        {closedAt && (
          <div className="text-xs text-muted-foreground">
            {closed ? (
              <span>Closed on {deadlineText}</span>
            ) : (
              <span>Ends {deadlineText}</span>
            )}
          </div>
        )}

        {/* Zap Button */}
        {!closed && (
          <Button onClick={handleZap} className="w-full">
            <Zap className="size-4" />
            Zap this Goal
          </Button>
        )}
      </div>
    </BaseEventContainer>
  );
}
