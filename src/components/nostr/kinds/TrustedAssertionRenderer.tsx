import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { UserName } from "../UserName";
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
import { BarChart3 } from "lucide-react";

/**
 * Subject display based on assertion kind
 */
function AssertionSubject({
  event,
  subject,
}: {
  event: BaseEventProps["event"];
  subject: string;
}) {
  if (event.kind === 30382) {
    // User: show as UserName
    return <UserName pubkey={subject} className="text-sm font-medium" />;
  }

  if (event.kind === 30385) {
    // NIP-73 external identifier: use shared component with proper icon
    const kTypes = getExternalAssertionTypes(event);
    return (
      <ExternalIdentifierInline
        value={subject}
        kType={kTypes[0]}
        className="text-sm"
      />
    );
  }

  if (event.kind === 30384) {
    // Addressable event: kind:pubkey:d-tag
    const parts = subject.split(":");
    if (parts.length >= 3) {
      return (
        <span className="text-sm font-mono text-muted-foreground">
          {parts[0]}:{parts[1].slice(0, 8)}...:{parts[2] || "*"}
        </span>
      );
    }
  }

  // Event ID (30383) or fallback
  return (
    <span className="text-sm font-mono text-muted-foreground truncate">
      {subject.slice(0, 16)}...
    </span>
  );
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

  // Get kind-specific summary metrics
  let summaryMetrics: { label: string; value: string }[] = [];

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
        label: "Zaps Recd",
        value: `${data.zapAmountReceived.toLocaleString()} sats`,
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
        value: `${data.zapAmount.toLocaleString()} sats`,
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
      {/* Rank badge */}
      {rankTag && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, parseInt(rankTag.value, 10)))}%`,
                }}
              />
            </div>
            <span className="text-xs font-medium">{rankTag.value}/100</span>
          </div>
        </div>
      )}

      {/* Summary metrics */}
      {summaryMetrics.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {summaryMetrics.map((m) => (
            <span key={m.label} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.value}</span>{" "}
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
        <div className="flex items-center gap-2">
          <ClickableEventTitle
            event={event}
            className="text-base font-semibold"
          >
            <span className="flex items-center gap-1.5">
              <BarChart3 className="size-4 text-muted-foreground" />
              {kindLabel}
            </span>
          </ClickableEventTitle>
        </div>

        {/* Subject */}
        {subject && (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Subject:</span>
            <AssertionSubject event={event} subject={subject} />
          </div>
        )}

        {/* Metrics preview */}
        <MetricsPreview event={event} />
      </div>
    </BaseEventContainer>
  );
}
