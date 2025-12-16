import { useMemo } from "react";
import { Tag, FolderGit2 } from "lucide-react";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import type { NostrEvent } from "@/types/nostr";
import {
  getIssueTitle,
  getIssueLabels,
  getIssueRepositoryAddress,
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/Label";

/**
 * Detail renderer for Kind 1621 - Issue (NIP-34)
 * Full view with repository context and markdown description
 */
export function IssueDetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();

  const title = useMemo(() => getIssueTitle(event), [event]);
  const labels = useMemo(() => getIssueLabels(event), [event]);
  const repoAddress = useMemo(() => getIssueRepositoryAddress(event), [event]);

  // Parse repository address if present
  const repoPointer = useMemo(() => {
    if (!repoAddress) return null;
    try {
      const [kindStr, pubkey, identifier] = repoAddress.split(":");
      return {
        kind: parseInt(kindStr),
        pubkey,
        identifier,
      };
    } catch {
      return null;
    }
  }, [repoAddress]);

  // Fetch repository event
  const repoEvent = useNostrEvent(repoPointer || undefined);

  // Get repository display name
  const repoName = repoEvent
    ? getRepositoryName(repoEvent) ||
      getRepositoryIdentifier(repoEvent) ||
      "Repository"
    : repoPointer?.identifier || "Unknown Repository";

  // Format created date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  const handleRepoClick = () => {
    if (!repoPointer || !repoEvent) return;
    addWindow("open", { pointer: repoPointer });
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Issue Header */}
      <header className="flex flex-col gap-4 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-3xl font-bold">{title || "Untitled Issue"}</h1>

        {/* Repository Link */}
        {repoAddress && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Repository:</span>
            <button
              onClick={repoEvent ? handleRepoClick : undefined}
              disabled={!repoEvent}
              className={`flex items-center gap-2 font-mono ${
                repoEvent
                  ? "text-muted-foreground underline decoration-dotted cursor-crosshair hover:text-primary"
                  : "text-muted-foreground cursor-not-allowed"
              }`}
            >
              <FolderGit2 className="size-4" />
              {repoName}
            </button>
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

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="size-3 text-muted-foreground" />
            {labels.map((label, idx) => (
              <Label key={idx} size="md">
                {label}
              </Label>
            ))}
          </div>
        )}
      </header>

      {/* Issue Body - Markdown */}
      {event.content ? (
        <MarkdownContent content={event.content} />
      ) : (
        <p className="text-sm text-muted-foreground italic">
          (No description provided)
        </p>
      )}
    </div>
  );
}
