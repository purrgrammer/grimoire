import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import {
  getAssertionSubject,
  getAssertionTags,
  getUserAssertionData,
  getEventAssertionData,
  getExternalAssertionData,
  getExternalAssertionTypes,
  ASSERTION_KIND_LABELS,
  ASSERTION_TAG_LABELS,
} from "@/lib/nip85-helpers";
import { formatTimestamp } from "@/hooks/useLocale";
import { BarChart3, User, FileText, Link, Hash } from "lucide-react";

/**
 * Rank visualization bar
 */
function RankBar({ rank }: { rank: number }) {
  const clamped = Math.min(100, Math.max(0, rank));
  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums w-12 text-right">
        {rank}/100
      </span>
    </div>
  );
}

/**
 * Metric row for detail table
 */
function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Subject header section based on kind
 */
function SubjectHeader({ kind, subject }: { kind: number; subject: string }) {
  const icon =
    kind === 30382 ? (
      <User className="size-4" />
    ) : kind === 30385 ? (
      <Link className="size-4" />
    ) : (
      <FileText className="size-4" />
    );

  return (
    <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
      <span className="text-muted-foreground">{icon}</span>
      {kind === 30382 ? (
        <UserName pubkey={subject} className="font-medium" />
      ) : (
        <span className="font-mono text-sm break-all">{subject}</span>
      )}
    </div>
  );
}

/**
 * User assertion metrics (kind 30382)
 */
function UserMetrics({ event }: { event: NostrEvent }) {
  const data = getUserAssertionData(event);

  const metrics: { label: string; value: string | number }[] = [];

  if (data.followers !== undefined)
    metrics.push({
      label: "Followers",
      value: data.followers.toLocaleString(),
    });
  if (data.postCount !== undefined)
    metrics.push({ label: "Posts", value: data.postCount.toLocaleString() });
  if (data.replyCount !== undefined)
    metrics.push({ label: "Replies", value: data.replyCount.toLocaleString() });
  if (data.reactionsCount !== undefined)
    metrics.push({
      label: "Reactions",
      value: data.reactionsCount.toLocaleString(),
    });
  if (data.zapAmountReceived !== undefined)
    metrics.push({
      label: "Zaps Received",
      value: `${data.zapAmountReceived.toLocaleString()} sats`,
    });
  if (data.zapAmountSent !== undefined)
    metrics.push({
      label: "Zaps Sent",
      value: `${data.zapAmountSent.toLocaleString()} sats`,
    });
  if (data.zapCountReceived !== undefined)
    metrics.push({
      label: "Zap Count Received",
      value: data.zapCountReceived.toLocaleString(),
    });
  if (data.zapCountSent !== undefined)
    metrics.push({
      label: "Zap Count Sent",
      value: data.zapCountSent.toLocaleString(),
    });
  if (data.zapAvgAmountDayReceived !== undefined)
    metrics.push({
      label: "Avg Zap/Day Received",
      value: `${data.zapAvgAmountDayReceived.toLocaleString()} sats`,
    });
  if (data.zapAvgAmountDaySent !== undefined)
    metrics.push({
      label: "Avg Zap/Day Sent",
      value: `${data.zapAvgAmountDaySent.toLocaleString()} sats`,
    });
  if (data.reportsReceived !== undefined)
    metrics.push({
      label: "Reports Received",
      value: data.reportsReceived.toLocaleString(),
    });
  if (data.reportsSent !== undefined)
    metrics.push({
      label: "Reports Sent",
      value: data.reportsSent.toLocaleString(),
    });
  if (data.firstCreatedAt !== undefined)
    metrics.push({
      label: "First Post",
      value: formatTimestamp(data.firstCreatedAt, "long"),
    });
  if (data.activeHoursStart !== undefined && data.activeHoursEnd !== undefined)
    metrics.push({
      label: "Active Hours (UTC)",
      value: `${data.activeHoursStart}:00 - ${data.activeHoursEnd}:00`,
    });

  return (
    <>
      {metrics.length > 0 && (
        <div className="flex flex-col">
          {metrics.map((m) => (
            <MetricRow key={m.label} label={m.label} value={m.value} />
          ))}
        </div>
      )}
      {data.topics && data.topics.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">Topics</span>
          <div className="flex flex-wrap gap-1.5">
            {data.topics.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
              >
                <Hash className="size-3" />
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Event/address assertion metrics (kind 30383/30384)
 */
function EventMetrics({ event }: { event: NostrEvent }) {
  const data = getEventAssertionData(event);

  const metrics: { label: string; value: string | number }[] = [];

  if (data.commentCount !== undefined)
    metrics.push({
      label: "Comments",
      value: data.commentCount.toLocaleString(),
    });
  if (data.quoteCount !== undefined)
    metrics.push({ label: "Quotes", value: data.quoteCount.toLocaleString() });
  if (data.repostCount !== undefined)
    metrics.push({
      label: "Reposts",
      value: data.repostCount.toLocaleString(),
    });
  if (data.reactionCount !== undefined)
    metrics.push({
      label: "Reactions",
      value: data.reactionCount.toLocaleString(),
    });
  if (data.zapCount !== undefined)
    metrics.push({ label: "Zap Count", value: data.zapCount.toLocaleString() });
  if (data.zapAmount !== undefined)
    metrics.push({
      label: "Zap Amount",
      value: `${data.zapAmount.toLocaleString()} sats`,
    });

  if (metrics.length === 0) return null;

  return (
    <div className="flex flex-col">
      {metrics.map((m) => (
        <MetricRow key={m.label} label={m.label} value={m.value} />
      ))}
    </div>
  );
}

/**
 * External assertion metrics (kind 30385)
 */
function ExternalMetrics({ event }: { event: NostrEvent }) {
  const data = getExternalAssertionData(event);
  const types = getExternalAssertionTypes(event);

  const metrics: { label: string; value: string | number }[] = [];

  if (data.commentCount !== undefined)
    metrics.push({
      label: "Comments",
      value: data.commentCount.toLocaleString(),
    });
  if (data.reactionCount !== undefined)
    metrics.push({
      label: "Reactions",
      value: data.reactionCount.toLocaleString(),
    });

  return (
    <>
      {types.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">Type</span>
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      {metrics.length > 0 && (
        <div className="flex flex-col">
          {metrics.map((m) => (
            <MetricRow key={m.label} label={m.label} value={m.value} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Fallback: show any unrecognized tags as raw rows
 */
function RawAssertionTags({ event }: { event: NostrEvent }) {
  const tags = getAssertionTags(event);
  const knownTags = new Set(Object.keys(ASSERTION_TAG_LABELS));
  // Also filter topics since they're shown separately
  const unknownTags = tags.filter(
    (t) => !knownTags.has(t.name) && t.name !== "t",
  );

  if (unknownTags.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">Other Tags</span>
      <div className="flex flex-col">
        {unknownTags.map((t, i) => (
          <MetricRow key={`${t.name}-${i}`} label={t.name} value={t.value} />
        ))}
      </div>
    </div>
  );
}

/**
 * Trusted Assertion Detail Renderer (Kinds 30382-30385)
 */
export function TrustedAssertionDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const subject = getAssertionSubject(event);
  const kindLabel = ASSERTION_KIND_LABELS[event.kind] || "Assertion";
  const tags = getAssertionTags(event);
  const rankTag = tags.find((t) => t.name === "rank");

  return (
    <div className="flex flex-col gap-5 p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{kindLabel}</h2>
      </div>

      {/* Provider */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Provider:</span>
        <UserName pubkey={event.pubkey} className="font-medium" />
      </div>

      {/* Subject */}
      {subject && <SubjectHeader kind={event.kind} subject={subject} />}

      {/* Rank */}
      {rankTag && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">Rank</span>
          <RankBar rank={parseInt(rankTag.value, 10)} />
        </div>
      )}

      {/* Kind-specific metrics */}
      {event.kind === 30382 && <UserMetrics event={event} />}
      {(event.kind === 30383 || event.kind === 30384) && (
        <EventMetrics event={event} />
      )}
      {event.kind === 30385 && <ExternalMetrics event={event} />}

      {/* Raw/unknown tags */}
      <RawAssertionTags event={event} />
    </div>
  );
}
