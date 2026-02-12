import { useMemo } from "react";
import { GitBranch } from "lucide-react";
import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getPullRequestSubject,
  getPullRequestLabels,
  getPullRequestBranchName,
  getPullRequestRepositoryAddress,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";
import { StatusIndicator } from "../StatusIndicator";
import { useTimeline } from "@/hooks/useTimeline";
import { useRepositoryRelays } from "@/hooks/useRepositoryRelays";

/**
 * Renderer for Kind 1618 - Pull Request
 * Displays as a compact PR card in feed view with status
 */
export function PullRequestRenderer({ event }: BaseEventProps) {
  const subject = getPullRequestSubject(event);
  const labels = getPullRequestLabels(event);
  const branchName = getPullRequestBranchName(event);
  const repoAddress = getPullRequestRepositoryAddress(event);

  const { relays: statusRelays, repositoryEvent } =
    useRepositoryRelays(repoAddress);

  // Fetch status events that reference this PR
  const statusFilter = useMemo(
    () => ({
      kinds: [1630, 1631, 1632, 1633],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: statusEvents } = useTimeline(
    `pr-status-${event.id}`,
    statusFilter,
    statusRelays,
    { limit: 10 },
  );

  // Get valid status authors (PR author + repo owner + maintainers)
  const validAuthors = useMemo(
    () => getValidStatusAuthors(event, repositoryEvent),
    [event, repositoryEvent],
  );

  // Get the most recent valid status event
  const currentStatus = useMemo(
    () => findCurrentStatus(statusEvents, validAuthors),
    [statusEvents, validAuthors],
  );

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
          {/* Status and Repository */}
          <div className="flex items-center gap-2 text-xs">
            <StatusIndicator statusKind={currentStatus?.kind} eventType="pr" />
            {repoAddress && (
              <>
                <span className="text-muted-foreground">in</span>
                <RepositoryLink
                  repoAddress={repoAddress}
                  className="truncate line-clamp-1"
                />
              </>
            )}
          </div>
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
