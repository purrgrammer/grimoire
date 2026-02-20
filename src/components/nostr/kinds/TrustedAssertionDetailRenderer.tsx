import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import { QuotedEvent } from "../QuotedEvent";
import { ExternalIdentifierBlock } from "../ExternalIdentifierDisplay";
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
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import {
  getExternalIdentifierIcon,
  getExternalTypeLabel,
} from "@/lib/nip73-helpers";
import { formatTimestamp } from "@/hooks/useLocale";
import { ShieldCheck, User, Hash } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function rankColor(rank: number) {
  if (rank >= 70) return { indicator: "bg-success", text: "text-success" };
  if (rank >= 40) return { indicator: "bg-warning", text: "text-warning" };
  return { indicator: "bg-destructive", text: "text-destructive" };
}

/**
 * Color-coded rank bar with label, using Progress component
 */
function RankBar({ rank }: { rank: number }) {
  const clamped = Math.min(100, Math.max(0, rank));
  const { indicator, text } = rankColor(clamped);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">Rank</span>
      <div className="flex items-center gap-3">
        <Progress
          value={clamped}
          className="flex-1 bg-muted"
          indicatorClassName={indicator}
        />
        <span
          className={cn(
            "text-sm font-semibold tabular-nums w-12 text-right",
            text,
          )}
        >
          {rank}/100
        </span>
      </div>
    </div>
  );
}

/**
 * Metric row for detail table
 */
function MetricRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">
        {value}
        {unit && (
          <span className="text-xs font-normal text-muted-foreground ml-1">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Section header for metric groups
 */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground pt-2 first:pt-0">
      {children}
    </span>
  );
}

/**
 * Subject header — clickable for Nostr subjects, rich display for external
 */
function SubjectHeader({
  event,
  subject,
}: {
  event: NostrEvent;
  subject: string;
}) {
  // Kind 30385: NIP-73 external identifier
  if (event.kind === 30385) {
    const kTypes = getExternalAssertionTypes(event);
    return <ExternalIdentifierBlock value={subject} kType={kTypes[0]} />;
  }

  // Kind 30382: user pubkey
  if (event.kind === 30382) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
        <User className="size-4 text-muted-foreground" />
        <UserName pubkey={subject} className="font-medium" />
      </div>
    );
  }

  // Kind 30384: addressable event — quote the referenced event
  if (event.kind === 30384) {
    const pointer = parseReplaceableAddress(subject);
    if (pointer) return <QuotedEvent addressPointer={pointer} depth={1} />;
  }

  // Kind 30383: event ID — quote the referenced event
  return <QuotedEvent eventPointer={{ id: subject }} depth={1} />;
}

/**
 * User assertion metrics (kind 30382) — grouped into sections
 */
function UserMetrics({ event }: { event: NostrEvent }) {
  const data = getUserAssertionData(event);

  type Metric = { label: string; value: string | number; unit?: string };

  // Activity section
  const activity: Metric[] = [];
  if (data.postCount !== undefined)
    activity.push({ label: "Posts", value: data.postCount.toLocaleString() });
  if (data.replyCount !== undefined)
    activity.push({
      label: "Replies",
      value: data.replyCount.toLocaleString(),
    });
  if (data.reactionsCount !== undefined)
    activity.push({
      label: "Reactions",
      value: data.reactionsCount.toLocaleString(),
    });
  if (data.followers !== undefined)
    activity.push({
      label: "Followers",
      value: data.followers.toLocaleString(),
    });
  if (data.firstCreatedAt !== undefined)
    activity.push({
      label: "First Post",
      value: formatTimestamp(data.firstCreatedAt, "long"),
    });
  if (data.activeHoursStart !== undefined && data.activeHoursEnd !== undefined)
    activity.push({
      label: "Active Hours (UTC)",
      value: `${data.activeHoursStart}:00 – ${data.activeHoursEnd}:00`,
    });

  // Zaps section
  const zaps: Metric[] = [];
  if (data.zapAmountReceived !== undefined)
    zaps.push({
      label: "Received",
      value: data.zapAmountReceived.toLocaleString(),
      unit: "sats",
    });
  if (data.zapAmountSent !== undefined)
    zaps.push({
      label: "Sent",
      value: data.zapAmountSent.toLocaleString(),
      unit: "sats",
    });
  if (data.zapCountReceived !== undefined)
    zaps.push({
      label: "Count In",
      value: data.zapCountReceived.toLocaleString(),
    });
  if (data.zapCountSent !== undefined)
    zaps.push({
      label: "Count Out",
      value: data.zapCountSent.toLocaleString(),
    });
  if (data.zapAvgAmountDayReceived !== undefined)
    zaps.push({
      label: "Avg/Day In",
      value: data.zapAvgAmountDayReceived.toLocaleString(),
      unit: "sats",
    });
  if (data.zapAvgAmountDaySent !== undefined)
    zaps.push({
      label: "Avg/Day Out",
      value: data.zapAvgAmountDaySent.toLocaleString(),
      unit: "sats",
    });

  // Moderation section
  const moderation: Metric[] = [];
  if (data.reportsReceived !== undefined)
    moderation.push({
      label: "Reports Received",
      value: data.reportsReceived.toLocaleString(),
    });
  if (data.reportsSent !== undefined)
    moderation.push({
      label: "Reports Sent",
      value: data.reportsSent.toLocaleString(),
    });

  return (
    <div className="flex flex-col gap-3">
      {activity.length > 0 && (
        <div className="flex flex-col">
          <SectionHeader>Activity</SectionHeader>
          {activity.map((m) => (
            <MetricRow
              key={m.label}
              label={m.label}
              value={m.value}
              unit={m.unit}
            />
          ))}
        </div>
      )}

      {zaps.length > 0 && (
        <div className="flex flex-col">
          <SectionHeader>Zaps</SectionHeader>
          {zaps.map((m) => (
            <MetricRow
              key={m.label}
              label={m.label}
              value={m.value}
              unit={m.unit}
            />
          ))}
        </div>
      )}

      {moderation.length > 0 && (
        <div className="flex flex-col">
          <SectionHeader>Moderation</SectionHeader>
          {moderation.map((m) => (
            <MetricRow
              key={m.label}
              label={m.label}
              value={m.value}
              unit={m.unit}
            />
          ))}
        </div>
      )}

      {data.topics && data.topics.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionHeader>Topics</SectionHeader>
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
    </div>
  );
}

/**
 * Event/address assertion metrics (kind 30383/30384)
 */
function EventMetrics({ event }: { event: NostrEvent }) {
  const data = getEventAssertionData(event);

  const metrics: { label: string; value: string | number; unit?: string }[] =
    [];
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
      value: data.zapAmount.toLocaleString(),
      unit: "sats",
    });

  if (metrics.length === 0) return null;

  return (
    <div className="flex flex-col">
      <SectionHeader>Engagement</SectionHeader>
      {metrics.map((m) => (
        <MetricRow key={m.label} label={m.label} value={m.value} />
      ))}
    </div>
  );
}

/**
 * External assertion metrics (kind 30385) — with friendly type labels + icons
 */
function ExternalMetrics({ event }: { event: NostrEvent }) {
  const data = getExternalAssertionData(event);
  const types = getExternalAssertionTypes(event);

  const metrics: { label: string; value: string | number; unit?: string }[] =
    [];
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
          <SectionHeader>Content Type</SectionHeader>
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => {
              const Icon = getExternalIdentifierIcon(t);
              return (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                >
                  <Icon className="size-3" />
                  {getExternalTypeLabel(t)}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {metrics.length > 0 && (
        <div className="flex flex-col">
          <SectionHeader>Engagement</SectionHeader>
          {metrics.map((m) => (
            <MetricRow
              key={m.label}
              label={m.label}
              value={m.value}
              unit={m.unit}
            />
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
  const unknownTags = tags.filter(
    (t) => !knownTags.has(t.name) && t.name !== "t",
  );

  if (unknownTags.length === 0) return null;

  return (
    <div className="flex flex-col">
      <SectionHeader>Other</SectionHeader>
      {unknownTags.map((t, i) => (
        <MetricRow key={`${t.name}-${i}`} label={t.name} value={t.value} />
      ))}
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
        <ShieldCheck className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{kindLabel}</h2>
      </div>

      {/* Provider */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Provider:</span>
        <UserName pubkey={event.pubkey} className="font-medium" />
      </div>

      {/* Subject */}
      {subject && <SubjectHeader event={event} subject={subject} />}

      {/* Rank */}
      {rankTag && <RankBar rank={parseInt(rankTag.value, 10)} />}

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
