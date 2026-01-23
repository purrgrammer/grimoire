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
  getRepositoryRelays,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getOutboxes } from "applesauce-core/helpers";
import { Label } from "@/components/ui/label";
import { RepositoryLink } from "../RepositoryLink";
import { StatusIndicator } from "../StatusIndicator";
import { useTimeline } from "@/hooks/useTimeline";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

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
