import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { GitBranch } from "lucide-react";
import {
  getPullRequestSubject,
  getPullRequestLabels,
  getPullRequestBranchName,
  getPullRequestRepositoryAddress,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";

/**
 * Renderer for Kind 1618 - Pull Request
 * Displays as a compact PR card in feed view
 */
export function PullRequestRenderer({ event }: BaseEventProps) {
  const subject = getPullRequestSubject(event);
  const labels = getPullRequestLabels(event);
  const branchName = getPullRequestBranchName(event);
  const repoAddress = getPullRequestRepositoryAddress(event);

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
          {repoAddress && (
            <RepositoryLink
              repoAddress={repoAddress}
              className="truncate line-clamp-1 text-xs"
            />
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
