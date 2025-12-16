import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { FolderGit2, GitBranch } from "lucide-react";
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
    addWindow("open", { pointer: repoPointer });
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* PR Title */}
        <ClickableEventTitle
          event={event}
         
          className="font-semibold text-foreground"
        >
          {subject || "Untitled Pull Request"}
        </ClickableEventTitle>

        <div className="flex flex-col gap-1">
          {/* Repository */}
          {repoAddress && repoPointer && (
            <div
              onClick={handleRepoClick}
              className="flex items-center gap-1 text-muted-foreground cursor-crosshair underline decoration-dotted hover:text-primary truncate line-clamp-1 text-xs"
            >
              <FolderGit2 className="size-3 flex-shrink-0" />
              <span>{repoName}</span>
            </div>
          )}
          {/* Branch Name */}
          {branchName && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="size-3" />
              <span>{branchName}</span>
            </div>
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
