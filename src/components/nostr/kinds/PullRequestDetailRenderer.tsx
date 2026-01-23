import { useMemo } from "react";
import { GitBranch, Tag, Copy, CopyCheck } from "lucide-react";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import { useCopy } from "@/hooks/useCopy";
import { formatTimestamp } from "@/hooks/useLocale";
import type { NostrEvent } from "@/types/nostr";
import {
  getPullRequestSubject,
  getPullRequestLabels,
  getPullRequestCommitId,
  getPullRequestBranchName,
  getPullRequestCloneUrls,
  getPullRequestMergeBase,
  getPullRequestRepositoryAddress,
  getRepositoryRelays,
  getStatusType,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getOutboxes } from "applesauce-core/helpers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";
import { StatusIndicator } from "../StatusIndicator";
import { useTimeline } from "@/hooks/useTimeline";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * Detail renderer for Kind 1618 - Pull Request
 * Displays full PR content with markdown rendering and status
 */
export function PullRequestDetailRenderer({ event }: { event: NostrEvent }) {
  const { copy, copied } = useCopy();

  const subject = getPullRequestSubject(event);
  const labels = getPullRequestLabels(event);
  const commitId = getPullRequestCommitId(event);
  const branchName = getPullRequestBranchName(event);
  const cloneUrls = getPullRequestCloneUrls(event);
  const mergeBase = getPullRequestMergeBase(event);
  const repoAddress = getPullRequestRepositoryAddress(event);

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

  // Fetch repo author's relay list for fallback
  const repoAuthorRelayListPointer = useMemo(() => {
    if (!parsedRepo?.pubkey) return undefined;
    return { kind: 10002, pubkey: parsedRepo.pubkey, identifier: "" };
  }, [parsedRepo?.pubkey]);

  const repoAuthorRelayList = useNostrEvent(repoAuthorRelayListPointer);

  // Build relay list with fallbacks
  const statusRelays = useMemo(() => {
    if (repositoryEvent) {
      const repoRelays = getRepositoryRelays(repositoryEvent);
      if (repoRelays.length > 0) return repoRelays;
    }
    if (repoAuthorRelayList) {
      const authorOutbox = getOutboxes(repoAuthorRelayList);
      if (authorOutbox.length > 0) return authorOutbox;
    }
    return AGGREGATOR_RELAYS;
  }, [repositoryEvent, repoAuthorRelayList]);

  // Fetch status events
  const statusFilter = useMemo(
    () => ({
      kinds: [1630, 1631, 1632, 1633],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: statusEvents, loading: statusLoading } = useTimeline(
    `pr-status-${event.id}`,
    statusFilter,
    statusRelays,
    { limit: 20 },
  );

  // Get valid status authors
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
      {/* PR Header */}
      <header className="flex flex-col gap-3 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-2xl font-bold">
          {subject || "Untitled Pull Request"}
        </h1>

        {/* Status Badge (below title) */}
        <StatusIndicator
          statusKind={currentStatus?.kind}
          loading={statusLoading}
          eventType="pr"
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

      {/* Branch and Commit Info */}
      {(branchName || commitId || mergeBase) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitBranch className="size-5" />
            Branch Information
          </h2>

          {/* Branch Name */}
          {branchName && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Branch:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {branchName}
              </code>
              <button
                onClick={() => copy(branchName)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy branch name"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Commit ID */}
          {commitId && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Commit:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {commitId}
              </code>
              <button
                onClick={() => copy(commitId)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy commit ID"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Merge Base */}
          {mergeBase && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Merge Base:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {mergeBase}
              </code>
              <button
                onClick={() => copy(mergeBase)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy merge base"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Clone URLs */}
          {cloneUrls.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Clone URLs
              </h3>
              <ul className="flex flex-col gap-2">
                {cloneUrls.map((url, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 p-2 bg-muted/30 font-mono"
                  >
                    <code className="flex-1 text-sm break-all line-clamp-1">
                      {url}
                    </code>
                    <button
                      onClick={() => copy(url)}
                      className="flex-shrink-0 p-1 hover:bg-muted"
                      aria-label="Copy clone URL"
                    >
                      {copied ? (
                        <CopyCheck className="size-3 text-muted-foreground" />
                      ) : (
                        <Copy className="size-3 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* PR Description - Markdown */}
      {event.content ? (
        <MarkdownContent content={event.content} />
      ) : (
        <p className="text-sm text-muted-foreground italic">
          (No description provided)
        </p>
      )}

      {/* Status History */}
      {currentStatus && (
        <section className="flex flex-col gap-2 pt-4 border-t border-border">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Last Status Update
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <UserName pubkey={currentStatus.pubkey} />
            <span className="text-muted-foreground">
              {currentStatus.kind === 1631
                ? "merged"
                : getStatusType(currentStatus.kind) || "updated"}{" "}
              this pull request
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
