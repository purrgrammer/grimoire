import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getIssueTitle,
  getIssueLabels,
  getIssueRepositoryAddress,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";

/**
 * Renderer for Kind 1621 - Issue
 * Displays as a compact issue card in feed view
 */
export function IssueRenderer({ event }: BaseEventProps) {
  const title = getIssueTitle(event);
  const labels = getIssueLabels(event);
  const repoAddress = getIssueRepositoryAddress(event);

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
          {repoAddress && (
            <div className="text-xs line-clamp-1">
              <RepositoryLink repoAddress={repoAddress} />
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
