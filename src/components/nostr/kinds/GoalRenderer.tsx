import { useMemo } from "react";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { Zap } from "lucide-react";
import { useTimeline } from "@/hooks/useTimeline";
import {
  getGoalAmount,
  getGoalRelays,
  getGoalClosedAt,
  getGoalTitle,
  getGoalSummary,
  isGoalClosed,
} from "@/lib/nip75-helpers";
import { getZapAmount } from "applesauce-common/helpers/zap";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * Renderer for Kind 9041 - Zap Goals (NIP-75)
 * Shows goal title, description, and funding progress
 */
export function GoalRenderer({ event }: BaseEventProps) {
  const { locale, addWindow } = useGrimoire();

  // Get goal metadata
  const targetAmount = getGoalAmount(event);
  const goalRelays = getGoalRelays(event);
  const closedAt = getGoalClosedAt(event);
  const title = getGoalTitle(event);
  const summary = getGoalSummary(event);
  const closed = isGoalClosed(event);

  // Fetch zaps for this goal from specified relays
  const zapFilter = useMemo(
    () => ({
      kinds: [9735],
      "#e": [event.id],
    }),
    [event.id],
  );

  const relays = useMemo(
    () =>
      goalRelays.length > 0
        ? [...goalRelays, ...AGGREGATOR_RELAYS]
        : AGGREGATOR_RELAYS,
    [goalRelays],
  );

  const { events: zaps, loading } = useTimeline(
    `goal-zaps-${event.id}`,
    zapFilter,
    relays,
    { limit: 1000 },
  );

  // Calculate total raised
  const totalRaised = useMemo(() => {
    return zaps.reduce((sum, zap) => {
      const amount = getZapAmount(zap);
      return sum + (amount || 0);
    }, 0);
  }, [zaps]);

  // Convert to sats for display
  const targetSats = targetAmount ? Math.floor(targetAmount / 1000) : 0;
  const raisedSats = Math.floor(totalRaised / 1000);
  const progress =
    targetSats > 0 ? Math.min((raisedSats / targetSats) * 100, 100) : 0;

  // Format deadline
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
