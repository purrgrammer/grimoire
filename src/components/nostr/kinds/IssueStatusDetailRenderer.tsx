import { CircleDot, CheckCircle2, XCircle, FileEdit } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer } from "nostr-tools/nip19";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { RepositoryLink } from "../RepositoryLink";
import { useGrimoire } from "@/core/state";
import { formatTimestamp } from "@/hooks/useLocale";
import {
  getStatusRootEventId,
  getStatusRootRelayHint,
  getStatusRepositoryAddress,
  getStatusLabel,
  getStatusType,
} from "@/lib/nip34-helpers";

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
 * Get the color classes for a status badge
 * Uses theme semantic colors
 */
function getStatusBadgeClasses(kind: number): string {
  switch (kind) {
    case 1630: // Open - neutral
      return "bg-muted/50 text-foreground border-border";
    case 1631: // Resolved/Merged - positive
      return "bg-accent/20 text-accent border-accent/30";
    case 1632: // Closed - negative
      return "bg-destructive/20 text-destructive border-destructive/30";
    case 1633: // Draft - muted
      return "bg-muted text-muted-foreground border-muted-foreground/30";
    default:
      return "bg-muted/50 text-foreground border-border";
  }
}

/**
 * Detail renderer for Kind 1630-1633 - Issue/Patch/PR Status Events
 * Full view with status info, referenced event, and optional comment
 */
export function IssueStatusDetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();

  const rootEventId = getStatusRootEventId(event);
  const relayHint = getStatusRootRelayHint(event);
  const repoAddress = getStatusRepositoryAddress(event);
  const statusLabel = getStatusLabel(event.kind);
  const statusType = getStatusType(event.kind);

  const StatusIcon = getStatusIcon(event.kind);
  const badgeClasses = getStatusBadgeClasses(event.kind);

  // Build event pointer with relay hint if available
  const eventPointer: EventPointer | undefined = rootEventId
    ? {
        id: rootEventId,
        relays: relayHint ? [relayHint] : undefined,
      }
    : undefined;

  // Format created date using locale utility
  const createdDate = formatTimestamp(event.created_at, "datetime");

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Status Header */}
      <header className="flex flex-col gap-4 pb-4 border-b border-border">
        {/* Status Badge */}
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border ${badgeClasses}`}
          >
            <StatusIcon className="size-4" />
            <span className="capitalize">{statusType || statusLabel}</span>
          </span>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold">Status Update</h1>

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

      {/* Comment/Reason (if any) */}
      {event.content && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Comment</h2>
          <MarkdownContent content={event.content} />
        </section>
      )}

      {/* Referenced Event */}
      {eventPointer && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Referenced Event</h2>
          <EmbeddedEvent
            eventPointer={eventPointer}
            onOpen={(id) => {
              addWindow(
                "open",
                { id: id as string },
                `Event ${(id as string).slice(0, 8)}...`,
              );
            }}
            className="border border-muted rounded overflow-hidden"
          />
        </section>
      )}
    </div>
  );
}
