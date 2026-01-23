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
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";

/**
 * Detail renderer for Kind 1618 - Pull Request
 * Displays full PR content with markdown rendering
 */
export function PullRequestDetailRenderer({ event }: { event: NostrEvent }) {
  const { copy, copied } = useCopy();

  const subject = useMemo(() => getPullRequestSubject(event), [event]);
  const labels = useMemo(() => getPullRequestLabels(event), [event]);
  const commitId = useMemo(() => getPullRequestCommitId(event), [event]);
  const branchName = useMemo(() => getPullRequestBranchName(event), [event]);
  const cloneUrls = useMemo(() => getPullRequestCloneUrls(event), [event]);
  const mergeBase = useMemo(() => getPullRequestMergeBase(event), [event]);
  const repoAddress = useMemo(
    () => getPullRequestRepositoryAddress(event),
    [event],
  );

  // Format created date using locale utility
  const createdDate = formatTimestamp(event.created_at, "long");

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* PR Header */}
      <header className="flex flex-col gap-4 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-3xl font-bold">
          {subject || "Untitled Pull Request"}
        </h1>

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
    </div>
  );
}
