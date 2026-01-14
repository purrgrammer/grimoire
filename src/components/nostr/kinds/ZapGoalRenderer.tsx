import { useMemo } from "react";
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { Target, Zap } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { getZapAmount, getZapSender } from "applesauce-common/helpers/zap";
import { useTimeline } from "@/hooks/useTimeline";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { Progress } from "@/components/ui/progress";

/**
 * Renderer for Kind 9041 - Zap Goals (NIP-75)
 * Displays fundraising goal with progress bar
 */
export function ZapGoalRenderer({ event }: BaseEventProps) {
  // Get goal metadata from tags
  const amountMsats = getTagValue(event, "amount");
  const summary = getTagValue(event, "summary");
  const closedAtStr = getTagValue(event, "closed_at");
  const relaysTag = event.tags.find((t) => t[0] === "relays");
  const goalRelays = relaysTag ? relaysTag.slice(1) : [];

  // Parse amount (in millisatoshis)
  const targetAmount = amountMsats ? parseInt(amountMsats, 10) : 0;
  const targetSats = Math.floor(targetAmount / 1000);

  // Check if goal is closed
  const closedAt = closedAtStr ? parseInt(closedAtStr, 10) : null;
  const isClosed = closedAt ? Date.now() / 1000 > closedAt : false;

  // Format goal description
  const description = summary || event.content;

  // Query for zap receipts that reference this goal
  const relays = goalRelays.length > 0 ? goalRelays : AGGREGATOR_RELAYS;
  const { events: zapReceipts } = useTimeline(
    `zap-goal-${event.id}`,
    { kinds: [9735], "#e": [event.id] },
    relays,
    { limit: 1000 },
  );

  // Calculate total raised
  const totalRaisedMsats = useMemo(() => {
    let total = 0;
    for (const zapReceipt of zapReceipts) {
      const sender = getZapSender(zapReceipt);
      const amount = getZapAmount(zapReceipt);

      if (!sender || !amount) continue;

      // Skip zaps after closed_at if goal is closed
      if (closedAt && zapReceipt.created_at > closedAt) continue;

      total += amount;
    }
    return total;
  }, [zapReceipts, closedAt]);

  const totalRaisedSats = Math.floor(totalRaisedMsats / 1000);

  // Calculate progress percentage
  const progressPercentage =
    targetAmount > 0 ? (totalRaisedMsats / targetAmount) * 100 : 0;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Goal Header */}
        <div className="flex items-start gap-2">
          <Target className="size-5 text-primary mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base">Zap Goal</h3>
              {isClosed && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Closed
                </span>
              )}
            </div>
            {description && (
              <p className="text-sm text-foreground mt-1 break-words">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex flex-col gap-2">
          <Progress value={Math.min(progressPercentage, 100)} className="h-2" />

          {/* Progress Stats */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-zap fill-zap" />
              <span className="font-semibold text-zap">
                {totalRaisedSats.toLocaleString("en")}
              </span>
              <span className="text-muted-foreground">
                / {targetSats.toLocaleString("en")} sats
              </span>
            </div>
            <span className="text-muted-foreground">
              {progressPercentage.toFixed(0)}%
            </span>
          </div>
        </div>

        {closedAt && !isClosed && (
          <div className="text-xs text-muted-foreground">
            Closes{" "}
            {new Date(closedAt * 1000).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
