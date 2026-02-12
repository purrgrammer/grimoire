import { useMemo } from "react";
import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getIssueTitle,
  getIssueLabels,
  getIssueRepositoryAddress,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";
import { StatusIndicator } from "../StatusIndicator";
import { useTimeline } from "@/hooks/useTimeline";
import { useRepositoryRelays } from "@/hooks/useRepositoryRelays";

/**
 * Renderer for Kind 1621 - Issue
 * Displays as a compact issue card in feed view with status
 */
export function IssueRenderer({ event }: BaseEventProps) {
  const title = getIssueTitle(event);
  const labels = getIssueLabels(event);
  const repoAddress = getIssueRepositoryAddress(event);

  const { relays: statusRelays, repositoryEvent } =
    useRepositoryRelays(repoAddress);

  // Fetch status events that reference this issue
  const statusFilter = useMemo(
    () => ({
      kinds: [1630, 1631, 1632, 1633],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: statusEvents } = useTimeline(
    `issue-status-${event.id}`,
    statusFilter,
    statusRelays,
    { limit: 10 },
  );

  // Get valid status authors (issue author + repo owner + maintainers)
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
      <div className="flex flex-col gap-1">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="font-semibold text-foreground"
        >
          {title || "Untitled Issue"}
        </ClickableEventTitle>

        {/* Status */}
        <StatusIndicator statusKind={currentStatus?.kind} eventType="issue" />

        {/* Repository */}
        {repoAddress && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">in</span>
            <RepositoryLink repoAddress={repoAddress} />
          </div>
        )}

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex flex-wrap line-clamp-2 items-center gap-1 overflow-x-scroll mt-1">
            {labels.map((label, idx) => (
              <Label key={idx}>{label}</Label>
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
