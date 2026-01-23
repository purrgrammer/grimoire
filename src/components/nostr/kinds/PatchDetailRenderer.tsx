import { useMemo } from "react";
import { GitCommit, User, Copy, CopyCheck } from "lucide-react";
import { UserName } from "../UserName";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { useCopy } from "@/hooks/useCopy";
import { formatTimestamp } from "@/hooks/useLocale";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import type { NostrEvent } from "@/types/nostr";
import {
  getPatchSubject,
  getPatchCommitId,
  getPatchParentCommit,
  getPatchCommitter,
  getPatchRepositoryAddress,
  isPatchRoot,
  isPatchRootRevision,
} from "@/lib/nip34-helpers";
import { RepositoryLink } from "../RepositoryLink";

/**
 * Detail renderer for Kind 1617 - Patch
 * Displays full patch metadata and content
 */
export function PatchDetailRenderer({ event }: { event: NostrEvent }) {
  const { copy, copied } = useCopy();

  const subject = useMemo(() => getPatchSubject(event), [event]);
  const commitId = useMemo(() => getPatchCommitId(event), [event]);
  const parentCommit = useMemo(() => getPatchParentCommit(event), [event]);
  const committer = useMemo(() => getPatchCommitter(event), [event]);
  const repoAddress = useMemo(() => getPatchRepositoryAddress(event), [event]);
  const isRoot = useMemo(() => isPatchRoot(event), [event]);
  const isRootRevision = useMemo(() => isPatchRootRevision(event), [event]);

  // Format created date using locale utility
  const createdDate = formatTimestamp(event.created_at, "long");

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Patch Header */}
      <header className="flex flex-col gap-4 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-3xl font-bold">{subject || "Untitled Patch"}</h1>

        {/* Status Badges */}
        {(isRoot || isRootRevision) && (
          <div className="flex flex-wrap items-center gap-2">
            {isRoot && (
              <span className="px-3 py-1 bg-accent/20 text-accent text-sm border border-accent/30">
                Root Patch
              </span>
            )}
            {isRootRevision && (
              <span className="px-3 py-1 bg-primary/20 text-primary text-sm border border-primary/30">
                Root Revision
              </span>
            )}
          </div>
        )}

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
      </header>

      {/* Commit Information */}
      {(commitId || parentCommit || committer) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitCommit className="size-5 flex-shrink-0" />
            Commit Information
          </h2>

          {/* Commit ID */}
          {commitId && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Commit:</span>
              <code className="flex-1 text-sm font-mono line-clamp-1 truncate">
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

          {/* Parent Commit */}
          {parentCommit && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Parent:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {parentCommit}
              </code>
              <button
                onClick={() => copy(parentCommit)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy parent commit ID"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Committer Info */}
          {committer && (
            <div className="flex items-start gap-2 p-2 bg-muted/30">
              <User className="size-4 text-muted-foreground mt-0.5" />
              <div className="flex flex-row gap-2 text-sm truncate line-clamp-1">
                <span className="text-muted-foreground">Committer: </span>
                <div className="flex flex-row gap-1 truncate line-clamp-1">
                  <span className="font-semibold">{committer.name}</span>
                  {committer.email && (
                    <span className="text-muted-foreground">
                      &lt;{committer.email}&gt;
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Patch Content */}
      {event.content && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Patch</h2>
          <div className="relative">
            <SyntaxHighlight
              code={event.content}
              language="diff"
              className="overflow-x-auto bg-muted/30 p-4"
            />
            <CodeCopyButton
              onCopy={() => copy(event.content)}
              copied={copied}
              label="Copy patch"
            />
          </div>
        </section>
      )}
    </div>
  );
}
