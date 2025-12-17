import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { FolderGit2 } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import {
  getPatchSubject,
  getPatchCommitId,
  getPatchRepositoryAddress,
} from "@/lib/nip34-helpers";
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";

/**
 * Renderer for Kind 1617 - Patch
 * Displays as a compact patch card in feed view
 */
export function PatchRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const subject = getPatchSubject(event);
  const commitId = getPatchCommitId(event);
  const repoAddress = getPatchRepositoryAddress(event);

  // Parse repository address to get the pointer
  const repoPointer = repoAddress
    ? (() => {
        try {
          // Address format: "kind:pubkey:identifier"
          const [kindStr, pubkey, identifier] = repoAddress.split(":");
          return {
            kind: parseInt(kindStr),
            pubkey,
            identifier,
          };
        } catch {
          return null;
        }
      })()
    : null;

  // Fetch the repository event to get its name
  const repoEvent = useNostrEvent(
    repoPointer
      ? {
          kind: repoPointer.kind,
          pubkey: repoPointer.pubkey,
          identifier: repoPointer.identifier,
        }
      : undefined,
  );

  // Get repository display name
  const repoName = repoEvent
    ? getRepositoryName(repoEvent) ||
      getRepositoryIdentifier(repoEvent) ||
      "Repository"
    : repoAddress?.split(":")[2] || "Unknown Repository";

  const handleRepoClick = () => {
    if (!repoPointer) return;
    addWindow("open", { pointer: repoPointer });
  };

  // Shorten commit ID for display
  const shortCommitId = commitId ? commitId.slice(0, 7) : undefined;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Patch Subject */}
        <ClickableEventTitle
          event={event}
          className="font-semibold text-foreground"
        >
          {subject || "Untitled Patch"}
        </ClickableEventTitle>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>in</span>
          {/* Repository */}
          {repoAddress && repoPointer && (
            <div
              onClick={handleRepoClick}
              className="flex items-center gap-1 text-muted-foreground cursor-crosshair underline decoration-dotted hover:text-primary"
            >
              <FolderGit2 className="size-3" />
              <span>{repoName}</span>
            </div>
          )}

          {/* Commit ID */}
          {shortCommitId && (
            <>
              <span className="text-muted-foreground">•</span>
              <code className="text-muted-foreground font-mono text-xs">
                {shortCommitId}
              </code>
            </>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
