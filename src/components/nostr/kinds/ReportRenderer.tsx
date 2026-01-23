/**
 * NIP-56: Report Renderer (Kind 1984)
 *
 * Displays report events that signal objectionable content.
 * Reports can target profiles, events, or blobs.
 */

import { useMemo } from "react";
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
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { KindRenderer } from "./index";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "@/components/nostr/UserName";
import { EventCardSkeleton } from "@/components/ui/skeleton";
import {
  parseReport,
  type ReportType,
  REPORT_TYPE_LABELS,
} from "@/lib/nip56-helpers";

/**
 * Get icon for report type
 */
function getReportTypeIcon(reportType: ReportType) {
  switch (reportType) {
    case "nudity":
      return <AlertTriangle className="size-4 text-orange-500" />;
    case "malware":
      return <Bug className="size-4 text-red-500" />;
    case "profanity":
      return <MessageSquareWarning className="size-4 text-yellow-500" />;
    case "illegal":
      return <Gavel className="size-4 text-red-600" />;
    case "spam":
      return <Mail className="size-4 text-blue-500" />;
    case "impersonation":
      return <UserX className="size-4 text-purple-500" />;
    case "other":
    default:
      return <HelpCircle className="size-4 text-muted-foreground" />;
  }
}

/**
 * Get background color class for report type badge
 */
function getReportTypeBgClass(reportType: ReportType): string {
  switch (reportType) {
    case "nudity":
      return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
    case "malware":
      return "bg-red-500/10 text-red-600 dark:text-red-400";
    case "profanity":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    case "illegal":
      return "bg-red-600/10 text-red-700 dark:text-red-300";
    case "spam":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "impersonation":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400";
    case "other":
    default:
      return "bg-muted text-muted-foreground";
  }
}

/**
 * Renderer for Kind 1984 - Reports (NIP-56)
 */
export function ReportRenderer({ event }: BaseEventProps) {
  // Parse the report
  const report = useMemo(() => parseReport(event), [event]);

  // Get event pointer if reporting an event
  const eventPointer = useMemo(() => {
    if (!report?.reportedEventId) return undefined;
    return { id: report.reportedEventId };
  }, [report?.reportedEventId]);

  // Fetch reported event if applicable
  const reportedEvent = useNostrEvent(eventPointer);

  if (!report) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-sm text-muted-foreground">
          Invalid report event (missing required tags)
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Report header with type badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <Flag className="size-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-muted-foreground">Reported</span>

          {/* Report type badge */}
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${getReportTypeBgClass(report.reportType)}`}
          >
            {getReportTypeIcon(report.reportType)}
            {REPORT_TYPE_LABELS[report.reportType]}
          </span>
        </div>

        {/* Reported target */}
        <div className="flex flex-col gap-2">
          {/* Profile being reported */}
          {report.targetType === "profile" && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Profile:</span>
              <UserName pubkey={report.reportedPubkey} />
            </div>
          )}

          {/* Event being reported */}
          {report.targetType === "event" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Event by:</span>
                <UserName pubkey={report.reportedPubkey} />
              </div>

              {/* Embedded reported event */}
              {reportedEvent && (
                <div className="border border-muted rounded-md overflow-hidden">
                  <KindRenderer event={reportedEvent} depth={1} />
                </div>
              )}

              {/* Loading state */}
              {report.reportedEventId && !reportedEvent && (
                <div className="border border-muted rounded-md p-2">
                  <EventCardSkeleton variant="compact" showActions={false} />
                </div>
              )}
            </div>
          )}

          {/* Blob being reported */}
          {report.targetType === "blob" && (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Blob by:</span>
                <UserName pubkey={report.reportedPubkey} />
              </div>
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
        </div>

        {/* Report comment */}
        {report.comment && (
          <div className="text-sm border-l-2 border-muted pl-3 text-muted-foreground italic">
            "{report.comment}"
          </div>
        )}
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
