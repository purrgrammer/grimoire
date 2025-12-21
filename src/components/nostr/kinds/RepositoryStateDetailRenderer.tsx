import { useMemo } from "react";
import {
  GitBranch,
  GitCommit,
  Tag,
  Copy,
  CopyCheck,
  FolderGit2,
} from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import type { NostrEvent } from "@/types/nostr";
import {
  getRepositoryIdentifier,
  getRepositoryStateHead,
  parseHeadBranch,
  getRepositoryStateHeadCommit,
  getRepositoryStateBranches,
  getRepositoryStateTags,
  getRepositoryName,
} from "@/lib/nip34-helpers";

/**
 * Detail renderer for Kind 30618 - Repository State
 * Displays full repository state with all refs, branches, and tags
 */
export function RepositoryStateDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const { addWindow } = useGrimoire();
  const repoId = useMemo(() => getRepositoryIdentifier(event), [event]);
  const headRef = useMemo(() => getRepositoryStateHead(event), [event]);
  const branch = useMemo(() => parseHeadBranch(headRef), [headRef]);
  const commitHash = useMemo(
    () => getRepositoryStateHeadCommit(event),
    [event],
  );
  const branches = useMemo(() => getRepositoryStateBranches(event), [event]);
  const tags = useMemo(() => getRepositoryStateTags(event), [event]);

  // Create repository pointer (kind 30617)
  const repoPointer = useMemo(
    () =>
      repoId
        ? {
            kind: 30617,
            pubkey: event.pubkey,
            identifier: repoId,
          }
        : null,
    [repoId, event.pubkey],
  );

  // Fetch the repository event to get its name
  const repoEvent = useNostrEvent(repoPointer || undefined);

  // Get repository display name
  const displayName = repoEvent
    ? getRepositoryName(repoEvent) || repoId || "Repository"
    : repoId || "Repository";

  const handleRepoClick = () => {
    if (repoPointer) {
      addWindow("open", { pointer: repoPointer });
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Repository Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-4">
        {/* Name with link to repository */}
        {repoPointer ? (
          <h1
            onClick={handleRepoClick}
            className="text-3xl font-bold cursor-crosshair underline decoration-dotted hover:text-primary inline-flex items-center gap-2"
          >
            <FolderGit2 className="size-8" />
            {displayName}
          </h1>
        ) : (
          <h1 className="text-3xl font-bold">{displayName}</h1>
        )}

        {/* HEAD Info */}
        {branch && commitHash && (
          <div className="flex flex-col gap-2 p-3 bg-muted/30 rounded">
            <div className="flex items-center gap-2">
              <GitCommit className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">HEAD</span>
            </div>
            <div className="flex flex-col gap-1 pl-6">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Branch:</span>
                <code className="text-sm font-mono font-semibold">
                  {branch}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Commit:</span>
                <CommitHashItem hash={commitHash} />
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Branches Section */}
      {branches.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitBranch className="size-5" />
            Branches
          </h2>
          <ul className="flex flex-col gap-2">
            {branches.map(({ name, hash }) => (
              <li
                key={name}
                className="flex items-center justify-between gap-4 p-2 bg-muted/30 rounded"
              >
                <span className="text-sm font-mono font-semibold truncate">
                  {name}
                </span>
                <CommitHashItem hash={hash} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tags Section */}
      {tags.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Tag className="size-5" />
            Tags
          </h2>
          <ul className="flex flex-col gap-2">
            {tags.map(({ name, hash }) => (
              <li
                key={name}
                className="flex items-center justify-between gap-4 p-2 bg-muted/30 rounded"
              >
                <span className="text-sm font-mono font-semibold truncate">
                  {name}
                </span>
                <CommitHashItem hash={hash} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Raw HEAD Reference */}
      {headRef && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            HEAD Reference
          </h2>
          <code className="text-xs font-mono p-2 bg-muted/30 rounded">
            {headRef}
          </code>
        </section>
      )}
    </div>
  );
}

/**
 * Component to display a commit hash with copy button
 */
function CommitHashItem({ hash }: { hash: string }) {
  const { copy, copied } = useCopy();
  const shortHash = hash.substring(0, 8);

  return (
    <div className="flex items-center gap-2 group">
      <code className="text-xs font-mono text-muted-foreground">
        {shortHash}
      </code>
      <button
        onClick={() => copy(hash)}
        className="flex-shrink-0 p-1 hover:bg-muted rounded"
        aria-label="Copy commit hash"
        title={hash}
      >
        {copied ? (
          <CopyCheck className="size-3 text-muted-foreground" />
        ) : (
          <Copy className="size-3 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
