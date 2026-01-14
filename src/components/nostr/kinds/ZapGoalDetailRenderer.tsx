import { useMemo } from "react";
import { Target, Zap, TrendingUp } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { getZapAmount, getZapSender } from "applesauce-common/helpers/zap";
import { UserName } from "../UserName";
import { useTimeline } from "@/hooks/useTimeline";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 9041 - Zap Goals (NIP-75)
 * Displays full goal information with contributor breakdown
 */
export function ZapGoalDetailRenderer({ event }: { event: NostrEvent }) {
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

  // Aggregate zaps by sender pubkey
  const contributors = useMemo(() => {
    const contributorMap = new Map<
      string,
      { pubkey: string; totalMsats: number; zapCount: number }
    >();

    for (const zapReceipt of zapReceipts) {
      const sender = getZapSender(zapReceipt);
      const amount = getZapAmount(zapReceipt);

      if (!sender || !amount) continue;

      // Skip zaps after closed_at if goal is closed
      if (closedAt && zapReceipt.created_at > closedAt) continue;

      const existing = contributorMap.get(sender);
      if (existing) {
        existing.totalMsats += amount;
        existing.zapCount += 1;
      } else {
        contributorMap.set(sender, {
          pubkey: sender,
          totalMsats: amount,
          zapCount: 1,
        });
      }
    }

    // Convert to array and sort by total amount descending
    return Array.from(contributorMap.values()).sort(
      (a, b) => b.totalMsats - a.totalMsats,
    );
  }, [zapReceipts, closedAt]);

  // Calculate total raised
  const totalRaisedMsats = contributors.reduce(
    (sum, c) => sum + c.totalMsats,
    0,
  );
  const totalRaisedSats = Math.floor(totalRaisedMsats / 1000);

  // Calculate progress percentage
  const progressPercentage =
    targetAmount > 0 ? (totalRaisedMsats / targetAmount) * 100 : 0;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Goal Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        <div className="flex items-start gap-3">
          <Target className="size-8 text-primary mt-1 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h1 className="text-2xl font-bold">Zap Goal</h1>
              {isClosed && (
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                  Closed
                </span>
              )}
            </div>
            {description && (
              <p className="text-base text-foreground">{description}</p>
            )}
          </div>
        </div>

        {/* Progress Section */}
        <div className="flex flex-col gap-3">
          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
            <div
              className="h-full bg-zap transition-all duration-300"
              style={{
                width: `${Math.min(progressPercentage, 100)}%`,
              }}
            />
          </div>

          {/* Progress Stats */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-zap fill-zap" />
              <span className="font-bold text-lg text-zap">
                {totalRaisedSats.toLocaleString("en")}
              </span>
              <span className="text-muted-foreground">
                / {targetSats.toLocaleString("en")} sats
              </span>
            </div>
            <div className="text-muted-foreground">
              {progressPercentage.toFixed(1)}%
            </div>
          </div>
        </div>

        {closedAt && (
          <div className="text-sm text-muted-foreground">
            {isClosed ? "Closed" : "Closes"} on{" "}
            {new Date(closedAt * 1000).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
      </header>

      {/* Contributors Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">
            Top Contributors ({contributors.length})
          </h2>
        </div>

        {contributors.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No contributions yet
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {contributors.map((contributor, index) => {
              const sats = Math.floor(contributor.totalMsats / 1000);
              const percentOfTotal =
                totalRaisedMsats > 0
                  ? (contributor.totalMsats / totalRaisedMsats) * 100
                  : 0;

              return (
                <div
                  key={contributor.pubkey}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  {/* Rank */}
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm flex-shrink-0">
                    {index + 1}
                  </div>

                  {/* Contributor Info */}
                  <div className="flex-1 min-w-0">
                    <UserName
                      pubkey={contributor.pubkey}
                      className="font-medium"
                    />
                    <div className="text-xs text-muted-foreground">
                      {contributor.zapCount}{" "}
                      {contributor.zapCount === 1 ? "zap" : "zaps"}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      <Zap className="size-3 text-zap fill-zap" />
                      <span className="font-bold text-zap">
                        {sats.toLocaleString("en")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {percentOfTotal.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Goal Metadata */}
      {goalRelays.length > 0 && (
        <section className="flex flex-col gap-2 pt-4 border-t border-border">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Goal Relays
          </h3>
          <div className="flex flex-col gap-1">
            {goalRelays.map((relay) => (
              <div
                key={relay}
                className="text-xs text-muted-foreground font-mono"
              >
                {relay}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
