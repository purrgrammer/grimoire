import { GitPullRequestArrow, GitBranch, Copy, CopyCheck } from "lucide-react";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { RepositoryLink } from "../RepositoryLink";
import { useCopy } from "@/hooks/useCopy";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer } from "nostr-tools/nip19";
import {
  getPRUpdatePREventId,
  getPRUpdatePRRelayHint,
  getPRUpdateCommits,
  getPRUpdateBranchName,
  getPRUpdateRepositoryAddress,
} from "@/lib/nip34-helpers";

/**
 * Detail renderer for Kind 1619 - Pull Request Updates (NIP-34)
 * Full view showing the update details and referenced PR
 */
export function PRUpdateDetailRenderer({ event }: { event: NostrEvent }) {
  const { copy, copied } = useCopy();
  const { addWindow } = useGrimoire();

  const prEventId = getPRUpdatePREventId(event);
  const relayHint = getPRUpdatePRRelayHint(event);
  const commits = getPRUpdateCommits(event);
  const branchName = getPRUpdateBranchName(event);
  const repoAddress = getPRUpdateRepositoryAddress(event);

  // Build event pointer for the referenced PR
  const prPointer: EventPointer | undefined = prEventId
    ? { id: prEventId, relays: relayHint ? [relayHint] : undefined }
    : undefined;

  const createdDate = formatTimestamp(event.created_at, "long");

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-3 pb-4 border-b border-border">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitPullRequestArrow className="size-6" />
          Pull Request Update
        </h1>

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

      {/* Branch and Commits */}
      {(branchName || commits.length > 0) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitBranch className="size-5" />
            Update Details
          </h2>

          {branchName && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Branch:</span>
              <code className="flex-1 text-sm font-mono truncate">
                {branchName}
              </code>
            </div>
          )}

          {commits.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Commits ({commits.length})
              </h3>
              <ul className="flex flex-col gap-1">
                {commits.map((hash, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 p-2 bg-muted/30"
                  >
                    <code className="flex-1 text-sm font-mono truncate">
                      {hash}
                    </code>
                    <button
                      onClick={() => copy(hash)}
                      className="flex-shrink-0 p-1 hover:bg-muted"
                      aria-label="Copy commit hash"
                    >
                      {copied ? (
                        <CopyCheck className="size-3 text-muted-foreground" />
                      ) : (
                        <Copy className="size-3 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Description */}
      {event.content ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Description</h2>
          <MarkdownContent content={event.content} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          (No description provided)
        </p>
      )}

      {/* Referenced PR */}
      {prPointer && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Pull Request</h2>
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
        </section>
      )}
    </div>
  );
}
