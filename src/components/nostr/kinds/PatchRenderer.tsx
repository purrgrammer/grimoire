import { useMemo } from "react";
import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getPatchSubject,
  getPatchCommitId,
  getPatchRepositoryAddress,
  getRepositoryRelays,
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getOutboxes } from "applesauce-core/helpers";
import { RepositoryLink } from "../RepositoryLink";
import { StatusIndicator } from "../StatusIndicator";
import { useTimeline } from "@/hooks/useTimeline";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

/**
 * Renderer for Kind 1617 - Patch
 * Displays as a compact patch card in feed view with status
 */
export function PatchRenderer({ event }: BaseEventProps) {
  const subject = getPatchSubject(event);
  const commitId = getPatchCommitId(event);
  const repoAddress = getPatchRepositoryAddress(event);

  // Shorten commit ID for display
  const shortCommitId = commitId ? commitId.slice(0, 7) : undefined;

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

  // Fetch status events that reference this patch
  const statusFilter = useMemo(
    () => ({
      kinds: [1630, 1631, 1632, 1633],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: statusEvents } = useTimeline(
    `patch-status-${event.id}`,
    statusFilter,
    statusRelays,
    { limit: 10 },
  );

  // Get valid status authors (patch author + repo owner + maintainers)
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
        {/* Subject/Title */}
        <ClickableEventTitle
          event={event}
          className="font-semibold text-foreground"
        >
          {subject || "Untitled Patch"}
        </ClickableEventTitle>

        {/* Status and Metadata */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <StatusIndicator statusKind={currentStatus?.kind} eventType="patch" />
          {repoAddress && (
            <>
              <span className="text-muted-foreground">in</span>
              <RepositoryLink repoAddress={repoAddress} />
            </>
          )}

          {/* Commit ID */}
          {shortCommitId && (
            <>
              <span className="text-muted-foreground">•</span>
              <code className="text-muted-foreground font-mono text-xs">
                {shortCommitId}
              </code>
            </>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
