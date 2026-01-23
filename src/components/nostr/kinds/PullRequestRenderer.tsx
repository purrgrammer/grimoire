import { useMemo } from "react";
import {
  CircleDot,
  CheckCircle2,
  XCircle,
  FileEdit,
  GitBranch,
} from "lucide-react";
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
  getRepositoryRelays,
  getStatusType,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getOutboxes } from "applesauce-core/helpers";
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
 * Uses theme semantic colors
 */
function getStatusColorClass(kind: number): string {
  switch (kind) {
    case 1630: // Open - neutral
      return "text-foreground";
    case 1631: // Merged - positive
      return "text-accent";
    case 1632: // Closed - negative
      return "text-destructive";
    case 1633: // Draft - muted
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

/**
 * Renderer for Kind 1618 - Pull Request
 * Displays as a compact PR card in feed view with status
 */
export function PullRequestRenderer({ event }: BaseEventProps) {
  const subject = getPullRequestSubject(event);
  const labels = getPullRequestLabels(event);
  const branchName = getPullRequestBranchName(event);
  const repoAddress = getPullRequestRepositoryAddress(event);

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

  // Fetch repo author's relay list for fallback
  const repoAuthorRelayListPointer = useMemo(() => {
    if (!parsedRepo?.pubkey) return undefined;
    return { kind: 10002, pubkey: parsedRepo.pubkey, identifier: "" };
  }, [parsedRepo?.pubkey]);

  const repoAuthorRelayList = useNostrEvent(repoAuthorRelayListPointer);

  // Build relay list with fallbacks:
  // 1. Repository configured relays
  // 2. Repo author's outbox (write) relays
  // 3. AGGREGATOR_RELAYS as final fallback
  const statusRelays = useMemo(() => {
    // Try repository relays first
    if (repositoryEvent) {
      const repoRelays = getRepositoryRelays(repositoryEvent);
      if (repoRelays.length > 0) return repoRelays;
    }

    // Try repo author's outbox relays
    if (repoAuthorRelayList) {
      const authorOutbox = getOutboxes(repoAuthorRelayList);
      if (authorOutbox.length > 0) return authorOutbox;
    }

    // Fallback to aggregator relays
    return AGGREGATOR_RELAYS;
  }, [repositoryEvent, repoAuthorRelayList]);

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

  // Status display - for PRs, 1631 means "merged" not "resolved"
  const statusType = currentStatus
    ? currentStatus.kind === 1631
      ? "merged"
      : getStatusType(currentStatus.kind)
    : "open";
  const StatusIcon = currentStatus
    ? getStatusIcon(currentStatus.kind)
    : CircleDot;
  const statusColorClass = currentStatus
    ? getStatusColorClass(currentStatus.kind)
    : "text-foreground";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Status and PR Title */}
        <div className="flex items-center gap-2">
          <StatusIcon className={`size-4 flex-shrink-0 ${statusColorClass}`} />
          <ClickableEventTitle
            event={event}
            className="font-semibold text-foreground"
          >
            {subject || "Untitled Pull Request"}
          </ClickableEventTitle>
        </div>

        <div className="flex flex-col gap-1">
          {/* Status and Repository */}
          <div className="flex items-center gap-2 text-xs">
            <span className={statusColorClass}>{statusType}</span>
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
