import { useMemo } from "react";
import { Tag } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";
import { StatusIndicator } from "../StatusIndicator";
import { useTimeline } from "@/hooks/useTimeline";
import { useRepositoryRelays } from "@/hooks/useRepositoryRelays";
import { formatTimestamp } from "@/hooks/useLocale";

/**
 * Detail renderer for Kind 1621 - Issue (NIP-34)
 * Full view with repository context and markdown description
 */
export function IssueDetailRenderer({ event }: { event: NostrEvent }) {
  const title = getIssueTitle(event);
  const labels = getIssueLabels(event);
  const repoAddress = getIssueRepositoryAddress(event);

  const { relays: statusRelays, repositoryEvent } =
    useRepositoryRelays(repoAddress);

  // Fetch status events that reference this issue
  const statusFilter = useMemo(
    () => ({
      kinds: [1630, 1631, 1632, 1633],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: statusEvents } = useTimeline(
    `issue-status-${event.id}`,
    statusFilter,
    statusRelays,
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

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Issue Header */}
      <header className="flex flex-col gap-3 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-2xl font-bold">{title || "Untitled Issue"}</h1>

        {/* Status Badge (below title) */}
        <StatusIndicator
          statusKind={currentStatus?.kind}
          eventType="issue"
          variant="badge"
        />

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
            <div className="text-sm mt-1">
              <MarkdownContent content={currentStatus.content} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
