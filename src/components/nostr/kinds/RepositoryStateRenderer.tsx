import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { GitCommit, FolderGit2 } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import {
  getRepositoryIdentifier,
  getRepositoryStateHeadCommit,
  parseHeadBranch,
  getRepositoryStateHead,
  getRepositoryName,
} from "@/lib/nip34-helpers";

/**
 * Renderer for Kind 30618 - Repository State
 * Displays as a compact git push notification in feed view
 */
export function RepositoryStateRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const repoId = getRepositoryIdentifier(event);
  const headRef = getRepositoryStateHead(event);
  const branch = parseHeadBranch(headRef);
  const commitHash = getRepositoryStateHeadCommit(event);

  // Create repository pointer (kind 30617)
  const repoPointer = repoId
    ? {
        kind: 30617,
        pubkey: event.pubkey,
        identifier: repoId,
      }
    : null;

  // Fetch the repository event to get its name
  const repoEvent = useNostrEvent(repoPointer || undefined);

  // Get repository display name
  const repoName = repoEvent
    ? getRepositoryName(repoEvent) || repoId || "Repository"
    : repoId || "repository";

  const shortHash = commitHash?.substring(0, 8) || "unknown";
  const branchName = branch || "unknown";

  const handleRepoClick = () => {
    if (repoPointer) {
      addWindow("open", { pointer: repoPointer });
    }
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Push notification */}
        <div className="flex items-center gap-2 flex-wrap">
          <GitCommit className="size-4 text-muted-foreground flex-shrink-0" />
          <div className="text-sm font-medium text-foreground">
            <ClickableEventTitle event={event} className="" as="span">
              pushed{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
                {shortHash}
              </code>
            </ClickableEventTitle>{" "}
            to <span className="font-semibold">{branchName}</span> in{" "}
            {repoPointer ? (
              <span
                onClick={handleRepoClick}
                className="inline-flex items-center gap-1 cursor-crosshair underline decoration-dotted hover:text-primary"
              >
                <FolderGit2 className="size-3" />
                <span className="font-semibold">{repoName}</span>
              </span>
            ) : (
              <span className="font-semibold">{repoName}</span>
            )}
          </div>
        </div>
      </div>
    </BaseEventContainer>
  );
}
