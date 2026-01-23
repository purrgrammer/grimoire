import { useMemo } from "react";
import {
  Tag,
  CircleDot,
  CheckCircle2,
  XCircle,
  FileEdit,
  Loader2,
} from "lucide-react";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import type { NostrEvent } from "@/types/nostr";
import {
  getIssueTitle,
  getIssueLabels,
  getIssueRepositoryAddress,
  getStatusType,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";
import { useTimeline } from "@/hooks/useTimeline";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { formatTimestamp } from "@/hooks/useLocale";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * Get the icon for a status kind
 */
function getStatusIcon(kind: number) {
  switch (kind) {
    case 1630:
      return CircleDot;
    case 1631:
      return CheckCircle2;
    case 1632:
      return XCircle;
    case 1633:
      return FileEdit;
    default:
      return CircleDot;
  }
}

/**
 * Get the color classes for a status badge
 */
function getStatusBadgeClasses(kind: number): string {
  switch (kind) {
    case 1630: // Open
      return "bg-green-500/20 text-green-500 border-green-500/30";
    case 1631: // Resolved/Merged
      return "bg-purple-500/20 text-purple-500 border-purple-500/30";
    case 1632: // Closed
      return "bg-red-500/20 text-red-500 border-red-500/30";
    case 1633: // Draft
      return "bg-muted text-muted-foreground border-muted-foreground/30";
    default:
      return "bg-muted text-muted-foreground border-muted-foreground/30";
  }
}

/**
 * Detail renderer for Kind 1621 - Issue (NIP-34)
 * Full view with repository context and markdown description
 */
export function IssueDetailRenderer({ event }: { event: NostrEvent }) {
  const title = getIssueTitle(event);
  const labels = getIssueLabels(event);
  const repoAddress = getIssueRepositoryAddress(event);

  // Parse repository address for fetching repo event
  const parsedRepo = useMemo(
    () => (repoAddress ? parseReplaceableAddress(repoAddress) : null),
    [repoAddress],
  );

  // Fetch repository event to get maintainers list
  const repoPointer = useMemo(() => {
    if (!parsedRepo) return undefined;
    return {
      kind: parsedRepo.kind,
      pubkey: parsedRepo.pubkey,
      identifier: parsedRepo.identifier,
    };
  }, [parsedRepo]);

  const repositoryEvent = useNostrEvent(repoPointer);

  // Fetch status events that reference this issue
  // Status events use e tag with root marker to reference the issue
  const statusFilter = useMemo(
    () => ({
      kinds: [1630, 1631, 1632, 1633],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: statusEvents, loading: statusLoading } = useTimeline(
    `issue-status-${event.id}`,
    statusFilter,
    AGGREGATOR_RELAYS,
    { limit: 20 },
  );

  // Get valid status authors (issue author + repo owner + maintainers)
  const validAuthors = useMemo(
    () => getValidStatusAuthors(event, repositoryEvent),
    [event, repositoryEvent],
  );

  // Get the most recent valid status event
  const currentStatus = useMemo(
    () => findCurrentStatus(statusEvents, validAuthors),
    [statusEvents, validAuthors],
  );

  // Format created date using locale utility
  const createdDate = formatTimestamp(event.created_at, "long");

  // Get status display info
  const statusType = currentStatus ? getStatusType(currentStatus.kind) : null;
  const StatusIcon = currentStatus
    ? getStatusIcon(currentStatus.kind)
    : CircleDot;
  const statusBadgeClasses = currentStatus
    ? getStatusBadgeClasses(currentStatus.kind)
    : "bg-green-500/20 text-green-500 border-green-500/30";

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Issue Header */}
      <header className="flex flex-col gap-4 pb-4 border-b border-border">
        {/* Status Badge */}
        <div className="flex items-center gap-3">
          {statusLoading ? (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Loading status...</span>
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border ${statusBadgeClasses}`}
            >
              <StatusIcon className="size-4" />
              <span className="capitalize">{statusType || "open"}</span>
            </span>
          )}
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold">{title || "Untitled Issue"}</h1>

        {/* Repository Link */}
        {repoAddress && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Repository:</span>
            <RepositoryLink
              repoAddress={repoAddress}
              iconSize="size-4"
              className="font-mono"
            />
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="size-3 text-muted-foreground" />
            {labels.map((label, idx) => (
              <Label key={idx} size="md">
                {label}
              </Label>
            ))}
          </div>
        )}
      </header>

      {/* Issue Body - Markdown */}
      {event.content ? (
        <MarkdownContent content={event.content} />
      ) : (
        <p className="text-sm text-muted-foreground italic">
          (No description provided)
        </p>
      )}

      {/* Status History (if there are status events) */}
      {currentStatus && (
        <section className="flex flex-col gap-2 pt-4 border-t border-border">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Last Status Update
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <UserName pubkey={currentStatus.pubkey} />
            <span className="text-muted-foreground">
              {getStatusType(currentStatus.kind) || "updated"} this issue
            </span>
            <span className="text-muted-foreground">•</span>
            <time className="text-muted-foreground">
              {formatTimestamp(currentStatus.created_at, "date")}
            </time>
          </div>
          {currentStatus.content && (
            <p className="text-sm text-muted-foreground mt-1">
              {currentStatus.content}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
