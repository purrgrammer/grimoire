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
  getValidStatusAuthors,
  findCurrentStatus,
} from "@/lib/nip34-helpers";
import { RepositoryLink } from "../RepositoryLink";
import { StatusIndicator } from "../StatusIndicator";
import { useTimeline } from "@/hooks/useTimeline";
import { useRepositoryRelays } from "@/hooks/useRepositoryRelays";

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

  const { relays: statusRelays, repositoryEvent } =
    useRepositoryRelays(repoAddress);

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
