import { useMemo } from "react";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { Target, Clock } from "lucide-react";
import { useTimeline } from "@/hooks/useTimeline";
import {
  getGoalAmount,
  getGoalRelays,
  getGoalClosedAt,
  getGoalTitle,
  isGoalClosed,
} from "@/lib/nip75-helpers";
import { getZapAmount } from "applesauce-common/helpers/zap";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import { Progress } from "@/components/ui/progress";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * Renderer for Kind 9041 - Zap Goals (NIP-75)
 * Shows goal title, description, and funding progress
 */
export function GoalRenderer({ event }: BaseEventProps) {
  const { locale } = useGrimoire();

  // Get goal metadata
  const targetAmount = getGoalAmount(event);
  const goalRelays = getGoalRelays(event);
  const closedAt = getGoalClosedAt(event);
  const title = getGoalTitle(event);
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

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Title */}
        <div className="flex items-start gap-2">
          <Target className="size-5 text-primary mt-0.5 shrink-0" />
          <ClickableEventTitle
            event={event}
            className="text-base font-semibold text-foreground leading-tight"
          >
            {title}
          </ClickableEventTitle>
        </div>

        {/* Description (full content if different from title) */}
        {event.content && event.content.trim() !== title && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {event.content}
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
                    {targetSats.toLocaleString()} sats
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
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {closed ? (
              <span className="text-destructive">Closed</span>
            ) : (
              <span>Ends {deadlineText}</span>
            )}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
