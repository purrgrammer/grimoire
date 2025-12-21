import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getPatchSubject,
  getPatchCommitId,
  getPatchRepositoryAddress,
} from "@/lib/nip34-helpers";
import { RepositoryLink } from "../RepositoryLink";

/**
 * Renderer for Kind 1617 - Patch
 * Displays as a compact patch card in feed view
 */
export function PatchRenderer({ event }: BaseEventProps) {
  const subject = getPatchSubject(event);
  const commitId = getPatchCommitId(event);
  const repoAddress = getPatchRepositoryAddress(event);

  // Shorten commit ID for display
  const shortCommitId = commitId ? commitId.slice(0, 7) : undefined;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Patch Subject */}
        <ClickableEventTitle
          event={event}
          className="font-semibold text-foreground"
        >
          {subject || "Untitled Patch"}
        </ClickableEventTitle>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>in</span>
          {/* Repository */}
          {repoAddress && <RepositoryLink repoAddress={repoAddress} />}

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
