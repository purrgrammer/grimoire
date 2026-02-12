import { GitPullRequestArrow } from "lucide-react";
import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getPRUpdatePREventId,
  getPRUpdatePRRelayHint,
  getPRUpdateCommitTip,
  getPRUpdateBranchName,
  getPRUpdateRepositoryAddress,
} from "@/lib/nip34-helpers";
import { RepositoryLink } from "../RepositoryLink";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { useGrimoire } from "@/core/state";
import type { EventPointer } from "nostr-tools/nip19";

/**
 * Renderer for Kind 1619 - Pull Request Updates (NIP-34)
 * Displays a compact card showing the PR update with a reference
 * to the original PR event
 */
export function PRUpdateRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  const prEventId = getPRUpdatePREventId(event);
  const relayHint = getPRUpdatePRRelayHint(event);
  const commitTip = getPRUpdateCommitTip(event);
  const branchName = getPRUpdateBranchName(event);
  const repoAddress = getPRUpdateRepositoryAddress(event);

  const shortCommit = commitTip ? commitTip.slice(0, 7) : undefined;

  // Build event pointer for the referenced PR
  const prPointer: EventPointer | undefined = prEventId
    ? { id: prEventId, relays: relayHint ? [relayHint] : undefined }
    : undefined;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="font-semibold text-foreground"
        >
          <span className="flex items-center gap-1.5">
            <GitPullRequestArrow className="size-3.5 flex-shrink-0" />
            PR Update
            {branchName && (
              <code className="text-xs font-mono text-muted-foreground">
                {branchName}
              </code>
            )}
          </span>
        </ClickableEventTitle>

        {/* Metadata line */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {repoAddress && (
            <>
              <span className="text-muted-foreground">in</span>
              <RepositoryLink repoAddress={repoAddress} />
            </>
          )}
          {shortCommit && (
            <>
              <span className="text-muted-foreground">•</span>
              <code className="text-muted-foreground font-mono text-xs">
                {shortCommit}
              </code>
            </>
          )}
        </div>

        {/* Description preview */}
        {event.content && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {event.content}
          </p>
        )}

        {/* Embedded PR reference */}
        {prPointer && (
          <EmbeddedEvent
            eventPointer={prPointer}
            onOpen={(id) => {
              addWindow(
                "open",
                { id: id as string },
                `PR ${(id as string).slice(0, 8)}...`,
              );
            }}
            className="border border-muted rounded overflow-hidden"
          />
        )}
      </div>
    </BaseEventContainer>
  );
}
