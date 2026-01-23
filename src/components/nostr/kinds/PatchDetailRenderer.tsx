import { useMemo } from "react";
import { GitCommit, User, Copy, CopyCheck } from "lucide-react";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { useCopy } from "@/hooks/useCopy";
import { formatTimestamp } from "@/hooks/useLocale";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import type { NostrEvent } from "@/types/nostr";
import {
  getPatchSubject,
  getPatchCommitId,
  getPatchParentCommit,
  getPatchCommitter,
  getPatchRepositoryAddress,
  isPatchRoot,
  isPatchRootRevision,
  getRepositoryRelays,
  getStatusType,
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
 * Detail renderer for Kind 1617 - Patch
 * Displays full patch metadata and content with status
 */
export function PatchDetailRenderer({ event }: { event: NostrEvent }) {
  const { copy, copied } = useCopy();

  const subject = getPatchSubject(event);
  const commitId = getPatchCommitId(event);
  const parentCommit = getPatchParentCommit(event);
  const committer = getPatchCommitter(event);
  const repoAddress = getPatchRepositoryAddress(event);
  const isRoot = isPatchRoot(event);
  const isRootRevision = isPatchRootRevision(event);

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

  // Build relay list with fallbacks
  const statusRelays = useMemo(() => {
    if (repositoryEvent) {
      const repoRelays = getRepositoryRelays(repositoryEvent);
      if (repoRelays.length > 0) return repoRelays;
    }
    if (repoAuthorRelayList) {
      const authorOutbox = getOutboxes(repoAuthorRelayList);
      if (authorOutbox.length > 0) return authorOutbox;
    }
    return AGGREGATOR_RELAYS;
  }, [repositoryEvent, repoAuthorRelayList]);

  // Fetch status events
  const statusFilter = useMemo(
    () => ({
      kinds: [1630, 1631, 1632, 1633],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: statusEvents, loading: statusLoading } = useTimeline(
    `patch-status-${event.id}`,
    statusFilter,
    statusRelays,
    { limit: 20 },
  );

  // Get valid status authors
  const validAuthors = useMemo(
    () => getValidStatusAuthors(event, repositoryEvent),
    [event, repositoryEvent],
  );

  // Get the most recent valid status event
  const currentStatus = useMemo(
    () => findCurrentStatus(statusEvents, validAuthors),
    [statusEvents, validAuthors],
  );

  // Format created date using locale utility
  const createdDate = formatTimestamp(event.created_at, "long");

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Patch Header */}
      <header className="flex flex-col gap-3 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-2xl font-bold">{subject || "Untitled Patch"}</h1>

        {/* Status and Root badges (below title) */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusIndicator
            statusKind={currentStatus?.kind}
            loading={statusLoading}
            eventType="patch"
            variant="badge"
          />
          {isRoot && (
            <span className="px-2 py-1 bg-accent/20 text-accent text-xs border border-accent/30 rounded-sm">
              Root Patch
            </span>
          )}
          {isRootRevision && (
            <span className="px-2 py-1 bg-primary/20 text-primary text-xs border border-primary/30 rounded-sm">
              Root Revision
            </span>
          )}
        </div>

        {/* Repository Link */}
        {repoAddress && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Repository:</span>
            <RepositoryLink
              repoAddress={repoAddress}
              iconSize="size-4"
              className="font-mono"
            />
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>
      </header>

      {/* Commit Information */}
      {(commitId || parentCommit || committer) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitCommit className="size-5 flex-shrink-0" />
            Commit Information
          </h2>

          {/* Commit ID */}
          {commitId && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Commit:</span>
              <code className="flex-1 text-sm font-mono line-clamp-1 truncate">
                {commitId}
              </code>
              <button
                onClick={() => copy(commitId)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy commit ID"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Parent Commit */}
          {parentCommit && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Parent:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {parentCommit}
              </code>
              <button
                onClick={() => copy(parentCommit)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy parent commit ID"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Committer Info */}
          {committer && (
            <div className="flex items-start gap-2 p-2 bg-muted/30">
              <User className="size-4 text-muted-foreground mt-0.5" />
              <div className="flex flex-row gap-2 text-sm truncate line-clamp-1">
                <span className="text-muted-foreground">Committer: </span>
                <div className="flex flex-row gap-1 truncate line-clamp-1">
                  <span className="font-semibold">{committer.name}</span>
                  {committer.email && (
                    <span className="text-muted-foreground">
                      &lt;{committer.email}&gt;
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Patch Content */}
      {event.content && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Patch</h2>
          <div className="relative">
            <SyntaxHighlight
              code={event.content}
              language="diff"
              className="overflow-x-auto bg-muted/30 p-4"
            />
            <CodeCopyButton
              onCopy={() => copy(event.content)}
              copied={copied}
              label="Copy patch"
            />
          </div>
        </section>
      )}

      {/* Status History */}
      {currentStatus && (
        <section className="flex flex-col gap-2 pt-4 border-t border-border">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Last Status Update
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <UserName pubkey={currentStatus.pubkey} />
            <span className="text-muted-foreground">
              {currentStatus.kind === 1631
                ? "merged"
                : getStatusType(currentStatus.kind) || "updated"}{" "}
              this patch
            </span>
            <span className="text-muted-foreground">•</span>
            <time className="text-muted-foreground">
              {formatTimestamp(currentStatus.created_at, "date")}
            </time>
          </div>
          {currentStatus.content && (
            <div className="text-sm mt-1">
              <MarkdownContent content={currentStatus.content} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
