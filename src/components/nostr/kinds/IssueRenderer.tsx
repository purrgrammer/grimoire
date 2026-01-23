import { useMemo } from "react";
import { CircleDot, CheckCircle2, XCircle, FileEdit } from "lucide-react";
import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getIssueTitle,
  getIssueLabels,
  getIssueRepositoryAddress,
  getStatusType,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";
import { useTimeline } from "@/hooks/useTimeline";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * Get the icon for a status kind
 */
function getStatusIcon(kind: number) {
  switch (kind) {
    case 1630:
      return CircleDot;
    case 1631:
      return CheckCircle2;
    case 1632:
      return XCircle;
    case 1633:
      return FileEdit;
    default:
      return CircleDot;
  }
}

/**
 * Get the color class for a status kind
 */
function getStatusColorClass(kind: number): string {
  switch (kind) {
    case 1630: // Open
      return "text-green-500";
    case 1631: // Resolved/Merged
      return "text-purple-500";
    case 1632: // Closed
      return "text-red-500";
    case 1633: // Draft
      return "text-muted-foreground";
    default:
      return "text-green-500";
  }
}

/**
 * Renderer for Kind 1621 - Issue
 * Displays as a compact issue card in feed view with status
 */
export function IssueRenderer({ event }: BaseEventProps) {
  const title = getIssueTitle(event);
  const labels = getIssueLabels(event);
  const repoAddress = getIssueRepositoryAddress(event);

  // Parse repository address for fetching repo event
  const parsedRepo = useMemo(
    () => (repoAddress ? parseReplaceableAddress(repoAddress) : null),
    [repoAddress],
  );

  // Fetch repository event to get maintainers list
  const repoPointer = useMemo(() => {
    if (!parsedRepo) return undefined;
    return {
      kind: parsedRepo.kind,
      pubkey: parsedRepo.pubkey,
      identifier: parsedRepo.identifier,
    };
  }, [parsedRepo]);

  const repositoryEvent = useNostrEvent(repoPointer);

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
    AGGREGATOR_RELAYS,
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

  // Status display
  const statusType = currentStatus ? getStatusType(currentStatus.kind) : "open";
  const StatusIcon = currentStatus
    ? getStatusIcon(currentStatus.kind)
    : CircleDot;
  const statusColorClass = currentStatus
    ? getStatusColorClass(currentStatus.kind)
    : "text-green-500";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          {/* Status and Title */}
          <div className="flex items-center gap-2">
            <StatusIcon
              className={`size-4 flex-shrink-0 ${statusColorClass}`}
            />
            <ClickableEventTitle
              event={event}
              className="font-semibold text-foreground"
            >
              {title || "Untitled Issue"}
            </ClickableEventTitle>
          </div>

          {/* Status label (compact) */}
          <div className="flex items-center gap-2 text-xs">
            <span className={statusColorClass}>{statusType}</span>
            {repoAddress && (
              <>
                <span className="text-muted-foreground">in</span>
                <RepositoryLink repoAddress={repoAddress} />
              </>
            )}
          </div>
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
