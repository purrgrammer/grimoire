import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { FolderGit2 } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import {
  getPullRequestSubject,
  getPullRequestLabels,
  getPullRequestBranchName,
  getPullRequestRepositoryAddress,
} from "@/lib/nip34-helpers";
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/Label";

/**
 * Renderer for Kind 1618 - Pull Request
 * Displays as a compact PR card in feed view
 */
export function PullRequestRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const subject = getPullRequestSubject(event);
  const labels = getPullRequestLabels(event);
  const branchName = getPullRequestBranchName(event);
  const repoAddress = getPullRequestRepositoryAddress(event);

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
    addWindow("open", { pointer: repoPointer }, `Repository: ${repoName}`);
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* PR Title */}
        <div className="flex-1 min-w-0">
          <ClickableEventTitle
            event={event}
            windowTitle={subject || "Untitled Pull Request"}
            className="font-semibold text-foreground"
          >
            {subject || "Untitled Pull Request"}
          </ClickableEventTitle>
        </div>

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

          {/* Branch Name */}
          {branchName && (
            <>
              <span className="text-muted-foreground">•</span>
              <code className="text-muted-foreground font-mono text-xs">
                {branchName}
              </code>
            </>
          )}
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-scroll">
            {labels.map((label, idx) => (
              <Label key={idx}>{label}</Label>
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
