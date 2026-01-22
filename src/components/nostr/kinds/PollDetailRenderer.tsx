import { useMemo } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  ListCheck,
  ListChecks,
  Clock,
  Users,
  CheckCircle2,
  CircleDot,
} from "lucide-react";
import { useTimeline } from "@/hooks/useTimeline";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import { Progress } from "@/components/ui/progress";
import { UserName } from "../UserName";
import { Skeleton } from "@/components/ui/skeleton";
import { RelayLink } from "../RelayLink";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import {
  getPollQuestion,
  getPollOptions,
  getPollType,
  getPollEndsAt,
  getPollRelays,
  isPollEnded,
  countVotes,
  getUniqueVoterCount,
} from "@/lib/nip88-helpers";

/**
 * Detail renderer for Kind 1068 - Poll (NIP-88)
 * Shows full poll with vote counts and percentages
 */
export function PollDetailRenderer({ event }: { event: NostrEvent }) {
  const { locale } = useGrimoire();

  // Parse poll data
  const question = getPollQuestion(event);
  const options = getPollOptions(event);
  const pollType = getPollType(event);
  const endsAt = getPollEndsAt(event);
  const pollRelays = getPollRelays(event);
  const ended = isPollEnded(event);

  // Determine relays to fetch responses from
  const relays = useMemo(() => {
    if (pollRelays.length > 0) {
      return [...pollRelays, ...AGGREGATOR_RELAYS];
    }
    return AGGREGATOR_RELAYS;
  }, [pollRelays]);

  // Fetch poll responses
  const responseFilter = useMemo(
    () => ({
      kinds: [1018],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: responses, loading } = useTimeline(
    `poll-responses-${event.id}`,
    responseFilter,
    relays,
  );

  // Calculate votes
  const voteCounts = useMemo(
    () => countVotes(responses, pollType, endsAt),
    [responses, pollType, endsAt],
  );

  const voterCount = useMemo(
    () => getUniqueVoterCount(responses, endsAt),
    [responses, endsAt],
  );

  // Calculate total votes for percentages
  const totalVotes = useMemo(() => {
    let total = 0;
    for (const count of voteCounts.values()) {
      total += count;
    }
    return total;
  }, [voteCounts]);

  // Find the winning option(s)
  const maxVotes = useMemo(() => {
    let max = 0;
    for (const count of voteCounts.values()) {
      if (count > max) max = count;
    }
    return max;
  }, [voteCounts]);

  const endTimeText = endsAt
    ? formatTimestamp(endsAt, "absolute", locale.locale)
    : null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4">
        {/* Poll Type Badge */}
        <div className="flex items-center gap-2 text-muted-foreground">
          {pollType === "multiplechoice" ? (
            <ListChecks className="size-5" />
          ) : (
            <ListCheck className="size-5" />
          )}
          <span className="text-sm uppercase tracking-wide">
            {pollType === "multiplechoice"
              ? "Multiple Choice"
              : "Single Choice"}{" "}
            Poll
          </span>
          {ended && (
            <span className="px-2 py-0.5 text-xs bg-muted rounded-full">
              Ended
            </span>
          )}
        </div>

        {/* Question */}
        <h1 className="text-2xl font-bold text-foreground">
          {question || "Poll"}
        </h1>

        {/* Author */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>by</span>
          <UserName pubkey={event.pubkey} className="font-medium" />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 py-3 border-y border-border">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <span className="font-medium">{voterCount}</span>
          <span className="text-muted-foreground">
            {voterCount === 1 ? "voter" : "voters"}
          </span>
        </div>
        {endsAt && (
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {ended ? "Ended" : "Ends"} {endTimeText}
            </span>
          </div>
        )}
      </div>

      {/* Options with vote counts */}
      <div className="flex flex-col gap-3">
        {loading && responses.length === 0 ? (
          // Loading skeleton
          <div className="flex flex-col gap-3">
            {options.map((option) => (
              <div
                key={option.id}
                className="flex flex-col gap-2 p-4 bg-muted/30 rounded-lg"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        ) : (
          options.map((option) => {
            const votes = voteCounts.get(option.id) || 0;
            const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
            const isWinner = votes > 0 && votes === maxVotes;

            return (
              <div
                key={option.id}
                className={`flex flex-col gap-2 p-4 rounded-lg transition-colors ${
                  isWinner
                    ? "bg-primary/10 border border-primary/30"
                    : "bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {pollType === "multiplechoice" ? (
                      <CheckCircle2
                        className={`size-4 ${isWinner ? "text-primary" : "text-muted-foreground"}`}
                      />
                    ) : (
                      <CircleDot
                        className={`size-4 ${isWinner ? "text-primary" : "text-muted-foreground"}`}
                      />
                    )}
                    <span
                      className={`font-medium ${isWinner ? "text-foreground" : ""}`}
                    >
                      {option.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`font-mono ${isWinner ? "font-bold" : "text-muted-foreground"}`}
                    >
                      {votes}
                    </span>
                    <span className="text-muted-foreground">
                      ({percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <Progress
                  value={percentage}
                  className={`h-2 ${isWinner ? "[&>*]:bg-primary" : ""}`}
                />
              </div>
            );
          })
        )}

        {options.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No poll options defined.
          </p>
        )}
      </div>

      {/* Poll metadata */}
      {pollRelays.length > 0 && (
        <div className="flex flex-col gap-2 pt-4 border-t border-border">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Relays
          </h3>
          <div className="flex flex-col gap-1">
            {pollRelays.map((relay) => (
              <RelayLink
                key={relay}
                url={relay}
                showInboxOutbox={false}
                className="text-sm"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
