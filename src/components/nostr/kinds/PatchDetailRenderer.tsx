import { useMemo } from "react";
import { GitCommit, FolderGit2, User, Copy, CopyCheck } from "lucide-react";
import { UserName } from "../UserName";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { useCopy } from "@/hooks/useCopy";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
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
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";

/**
 * Detail renderer for Kind 1617 - Patch
 * Displays full patch metadata and content
 */
export function PatchDetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();

  const subject = useMemo(() => getPatchSubject(event), [event]);
  const commitId = useMemo(() => getPatchCommitId(event), [event]);
  const parentCommit = useMemo(() => getPatchParentCommit(event), [event]);
  const committer = useMemo(() => getPatchCommitter(event), [event]);
  const repoAddress = useMemo(() => getPatchRepositoryAddress(event), [event]);
  const isRoot = useMemo(() => isPatchRoot(event), [event]);
  const isRootRevision = useMemo(() => isPatchRootRevision(event), [event]);

  // Parse repository address
  const repoPointer = useMemo(() => {
    if (!repoAddress) return null;
    try {
      const [kindStr, pubkey, identifier] = repoAddress.split(":");
      return {
        kind: parseInt(kindStr),
        pubkey,
        identifier,
      };
    } catch {
      return null;
    }
  }, [repoAddress]);

  // Fetch repository event
  const repoEvent = useNostrEvent(repoPointer || undefined);

  // Get repository display name
  const repoName = repoEvent
    ? getRepositoryName(repoEvent) ||
      getRepositoryIdentifier(repoEvent) ||
      "Repository"
    : repoPointer?.identifier || "Unknown Repository";

  const handleRepoClick = () => {
    if (!repoPointer || !repoEvent) return;
    addWindow("open", { pointer: repoPointer }, `Repository: ${repoName}`);
  };

  // Format created date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

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
            <button
              onClick={repoEvent ? handleRepoClick : undefined}
              disabled={!repoEvent}
              className={`flex items-center gap-2 font-mono ${
                repoEvent
                  ? "text-muted-foreground underline decoration-dotted cursor-crosshair hover:text-primary"
                  : "text-muted-foreground cursor-not-allowed"
              }`}
            >
              <FolderGit2 className="size-4" />
              {repoName}
            </button>
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
