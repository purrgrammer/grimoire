import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { Label } from "@/components/ui/label";
import { UserName } from "../UserName";
import { QuotedEvent } from "../QuotedEvent";
import { ExternalIdentifierInline } from "../ExternalIdentifierDisplay";
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
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function rankColor(rank: number) {
  if (rank >= 70) return { indicator: "bg-success", text: "text-success" };
  if (rank >= 40) return { indicator: "bg-warning", text: "text-warning" };
  return { indicator: "bg-destructive", text: "text-destructive" };
}

/**
 * Color-coded rank bar using Progress component
 */
function RankBar({ rank }: { rank: number }) {
  const clamped = Math.min(100, Math.max(0, rank));
  const { indicator, text } = rankColor(clamped);

  return (
    <div className="flex items-center gap-1.5">
      <Progress
        value={clamped}
        className="w-32 bg-muted"
        indicatorClassName={indicator}
      />
      <span className={cn("text-xs font-semibold tabular-nums", text)}>
        {rank}
      </span>
    </div>
  );
}

/**
 * Subject as the visual anchor — rendered as ClickableEventTitle or QuotedEvent
 */
function SubjectTitle({
  event,
  subject,
}: {
  event: BaseEventProps["event"];
  subject: string;
}) {
  if (event.kind === 30382) {
    return (
      <ClickableEventTitle
        event={event}
        className="text-base font-semibold text-foreground"
      >
        <UserName pubkey={subject} className="text-base font-semibold" />
      </ClickableEventTitle>
    );
  }

  if (event.kind === 30385) {
    const kTypes = getExternalAssertionTypes(event);
    return (
      <ClickableEventTitle
        event={event}
        className="text-base font-semibold text-foreground"
      >
        <ExternalIdentifierInline
          value={subject}
          kType={kTypes[0]}
          className="text-sm font-medium"
        />
      </ClickableEventTitle>
    );
  }

  // Kind 30384: addressable event — quote inline
  if (event.kind === 30384) {
    const pointer = parseReplaceableAddress(subject);
    if (pointer) return <QuotedEvent addressPointer={pointer} depth={2} />;
  }

  // Kind 30383: event ID — quote inline
  return <QuotedEvent eventPointer={{ id: subject }} depth={2} />;
}

/**
 * Compact metrics preview — shows rank + top metrics
 */
function MetricsPreview({
  event,
}: {
  event: { kind: number } & BaseEventProps["event"];
}) {
  const tags = getAssertionTags(event);
  const rankTag = tags.find((t) => t.name === "rank");

  // Collect metric type labels for the tag row
  const metricLabels = tags
    .filter((t) => t.name !== "rank" && t.name !== "t")
    .map((t) => ASSERTION_TAG_LABELS[t.name] || t.name);

  let summaryMetrics: { label: string; value: string; unit?: string }[] = [];

  if (event.kind === 30382) {
    const data = getUserAssertionData(event);
    if (data.followers !== undefined)
      summaryMetrics.push({
        label: "Followers",
        value: data.followers.toLocaleString(),
      });
    if (data.postCount !== undefined)
      summaryMetrics.push({
        label: "Posts",
        value: data.postCount.toLocaleString(),
      });
    if (data.zapAmountReceived !== undefined)
      summaryMetrics.push({
        label: "Zaps In",
        value: data.zapAmountReceived.toLocaleString(),
        unit: "sats",
      });
  } else if (event.kind === 30383 || event.kind === 30384) {
    const data = getEventAssertionData(event);
    if (data.reactionCount !== undefined)
      summaryMetrics.push({
        label: "Reactions",
        value: data.reactionCount.toLocaleString(),
      });
    if (data.commentCount !== undefined)
      summaryMetrics.push({
        label: "Comments",
        value: data.commentCount.toLocaleString(),
      });
    if (data.zapAmount !== undefined)
      summaryMetrics.push({
        label: "Zaps",
        value: data.zapAmount.toLocaleString(),
        unit: "sats",
      });
  } else if (event.kind === 30385) {
    const data = getExternalAssertionData(event);
    if (data.reactionCount !== undefined)
      summaryMetrics.push({
        label: "Reactions",
        value: data.reactionCount.toLocaleString(),
      });
    if (data.commentCount !== undefined)
      summaryMetrics.push({
        label: "Comments",
        value: data.commentCount.toLocaleString(),
      });
  }

  // Fall back to raw tags if no structured data
  if (summaryMetrics.length === 0) {
    summaryMetrics = tags
      .filter((t) => t.name !== "rank" && t.name !== "t")
      .slice(0, 3)
      .map((t) => ({
        label: ASSERTION_TAG_LABELS[t.name] || t.name,
        value: t.value,
      }));
  } else {
    summaryMetrics = summaryMetrics.slice(0, 3);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Rank bar */}
      {rankTag && <RankBar rank={parseInt(rankTag.value, 10)} />}

      {/* Metric type labels */}
      {metricLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {metricLabels.map((l) => (
            <Label key={l}>{l}</Label>
          ))}
        </div>
      )}

      {/* Summary metrics */}
      {summaryMetrics.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {summaryMetrics.map((m) => (
            <span key={m.label} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.value}</span>
              {m.unit && (
                <span className="text-muted-foreground"> {m.unit}</span>
              )}{" "}
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Trusted Assertion Renderer — Feed View (Kinds 30382-30385)
 * Shared renderer for all four NIP-85 assertion event kinds
 */
export function TrustedAssertionRenderer({ event }: BaseEventProps) {
  const subject = getAssertionSubject(event);
  const kindLabel = ASSERTION_KIND_LABELS[event.kind] || "Assertion";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Kind label + subject as title */}
        <div className="flex flex-col gap-1">
          <Label className="w-fit">{kindLabel}</Label>
          {subject && <SubjectTitle event={event} subject={subject} />}
        </div>

        {/* Metrics preview */}
        <MetricsPreview event={event} />
      </div>
    </BaseEventContainer>
  );
}
