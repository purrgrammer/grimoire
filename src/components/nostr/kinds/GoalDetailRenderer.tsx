import { NostrEvent } from "@/types/nostr";
import { Zap } from "lucide-react";
import { useGoalProgress } from "@/hooks/useGoalProgress";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { UserName } from "../UserName";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Detail renderer for Kind 9041 - Zap Goals (NIP-75)
 * Shows full goal info with sorted contributor breakdown
 */
export function GoalDetailRenderer({ event }: { event: NostrEvent }) {
  const { locale, addWindow } = useGrimoire();
  const {
    title,
    summary,
    closedAt,
    closed,
    beneficiaries,
    targetSats,
    raisedSats,
    progress,
    contributors,
    loading,
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
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>

        {/* Description (summary tag only) */}
        {summary && (
          <p className="text-muted-foreground whitespace-pre-wrap">{summary}</p>
        )}

        {/* Deadline */}
        {closedAt && (
          <div className="text-sm text-muted-foreground">
            {closed ? (
              <span>Closed on {deadlineText}</span>
            ) : (
              <span>Ends {deadlineText}</span>
            )}
          </div>
        )}
      </div>

      {/* Progress Section */}
      {targetSats > 0 && (
        <div className="flex flex-col gap-3 p-4 bg-muted/30 rounded-lg">
          <div className="flex justify-between items-baseline">
            <span className="text-3xl font-bold text-foreground">
              {raisedSats.toLocaleString()}
            </span>
            <span className="text-muted-foreground">
              of {targetSats.toLocaleString()}
            </span>
          </div>
          <Progress value={progress} className="h-3" />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{contributors.length} contributors</span>
            <span className="font-medium text-foreground">
              {progress.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* Zap Button */}
      {!closed && (
        <Button onClick={handleZap} className="w-full">
          <Zap className="size-4" />
          Zap this Goal
        </Button>
      )}

      {/* Beneficiaries */}
      {beneficiaries.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Beneficiaries
          </h2>
          <div className="flex flex-wrap gap-2">
            {beneficiaries.map((pubkey) => (
              <div key={pubkey} className="px-2 py-1 bg-muted rounded text-sm">
                <UserName pubkey={pubkey} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contributors */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Contributors
        </h2>

        {loading && contributors.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        ) : contributors.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No contributions yet. Be the first to contribute!
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border/50">
            {contributors.map((contributor, index) => {
              const amountSats = Math.floor(contributor.totalAmount / 1000);
              return (
                <div
                  key={contributor.pubkey}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-6 text-right">
                      #{index + 1}
                    </span>
                    <UserName pubkey={contributor.pubkey} className="text-sm" />
                    {contributor.zapCount > 1 && (
                      <span className="text-xs text-muted-foreground">
                        ({contributor.zapCount} zaps)
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-sm font-medium">
                    {amountSats.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
