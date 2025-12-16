import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { FolderGit2 } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import {
  getIssueTitle,
  getIssueLabels,
  getIssueRepositoryAddress,
} from "@/lib/nip34-helpers";
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/Label";

/**
 * Renderer for Kind 1621 - Issue
 * Displays as a compact issue card in feed view
 */
export function IssueRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const title = getIssueTitle(event);
  const labels = getIssueLabels(event);
  const repoAddress = getIssueRepositoryAddress(event);

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
    addWindow("open", { pointer: repoPointer });
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          {/* Issue Title */}
          <ClickableEventTitle
            event={event}
           
            className="font-semibold text-foreground"
          >
            {title || "Untitled Issue"}
          </ClickableEventTitle>

          {/* Repository Reference */}
          {repoAddress && repoPointer && (
            <div className="text-xs line-clamp-1">
              <div
                onClick={handleRepoClick}
                className={`flex items-center gap-1 text-muted-foreground
                cursor-crosshair underline decoration-dotted hover:text-primary
              `}
              >
                <FolderGit2 className="size-3" />
                <span>{repoName}</span>
              </div>
            </div>
          )}
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div
            className="flex
            flex-wrap
            line-clamp-2
            items-center gap-1 overflow-x-scroll my-1"
          >
            {labels.map((label, idx) => (
              <Label key={idx}>{label}</Label>
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
