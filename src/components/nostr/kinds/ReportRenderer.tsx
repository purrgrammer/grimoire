/**
 * NIP-56: Report Renderer (Kind 1984)
 *
 * Displays report events that signal objectionable content.
 * Reports can target profiles, events, or blobs.
 */

import {
  Flag,
  AlertTriangle,
  Bug,
  MessageSquareWarning,
  Gavel,
  Mail,
  UserX,
  HelpCircle,
} from "lucide-react";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { QuotedEvent } from "@/components/nostr/QuotedEvent";
import { UserName } from "@/components/nostr/UserName";
import { RichText } from "../RichText";
import {
  getReportInfo,
  type ReportType,
  REPORT_TYPE_LABELS,
} from "@/lib/nip56-helpers";

/**
 * Get icon for report type (all muted/neutral colors)
 */
function getReportTypeIcon(reportType: ReportType) {
  const className = "size-3.5 text-muted-foreground";
  switch (reportType) {
    case "nudity":
      return <AlertTriangle className={className} />;
    case "malware":
      return <Bug className={className} />;
    case "profanity":
      return <MessageSquareWarning className={className} />;
    case "illegal":
      return <Gavel className={className} />;
    case "spam":
      return <Mail className={className} />;
    case "impersonation":
      return <UserX className={className} />;
    case "other":
    default:
      return <HelpCircle className={className} />;
  }
}

/**
 * Renderer for Kind 1984 - Reports (NIP-56)
 */
export function ReportRenderer({ event }: BaseEventProps) {
  // Parse report using cached helper (no useMemo needed - applesauce caches internally)
  const report = getReportInfo(event);

  if (!report) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-sm text-muted-foreground">
          Invalid report event (missing required tags)
        </div>
      </BaseEventContainer>
    );
  }

  const reasonLabel = REPORT_TYPE_LABELS[report.reportType].toLowerCase();

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Report header: "Reported <username> for <reason>" */}
        <ClickableEventTitle
          event={event}
          as="div"
          className="flex items-center gap-1.5 flex-wrap text-sm"
        >
          <Flag className="size-4 text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground">Reported</span>
          <UserName pubkey={report.reportedPubkey} />
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
            for {getReportTypeIcon(report.reportType)} {reasonLabel}
          </span>
        </ClickableEventTitle>

        {/* Reported event - collapsed with hidden preview (depth=2, hidePreview) */}
        {report.targetType === "event" && report.reportedEventId && (
          <QuotedEvent
            eventPointer={{ id: report.reportedEventId }}
            depth={2}
            hidePreview
            className="mt-0"
          />
        )}

        {/* Blob details */}
        {report.targetType === "blob" && (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Hash:</span>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                {report.reportedBlobHash?.slice(0, 16)}...
              </code>
            </div>
            {report.serverUrls && report.serverUrls.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Server: {report.serverUrls[0]}
              </div>
            )}
          </div>
        )}

        {/* Report comment - rendered like a kind 1 note */}
        {event.content && <RichText event={event} className="text-sm" />}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Detail renderer for Kind 1984 - Reports
 * Shows full report details with raw data
 */
export function ReportDetailRenderer({ event }: BaseEventProps) {
  // For now, use the same renderer for detail view
  // Could be enhanced later with more detailed info
  return <ReportRenderer event={event} />;
}
