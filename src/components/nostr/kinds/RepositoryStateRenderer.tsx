import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { GitCommit } from "lucide-react";
import {
  getRepositoryIdentifier,
  getRepositoryStateHeadCommit,
  parseHeadBranch,
  getRepositoryStateHead,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/Label";
import { RepositoryLink } from "../RepositoryLink";

/**
 * Renderer for Kind 30618 - Repository State
 * Displays as a compact git push notification in feed view
 */
export function RepositoryStateRenderer({ event }: BaseEventProps) {
  const repoId = getRepositoryIdentifier(event);
  const headRef = getRepositoryStateHead(event);
  const branch = parseHeadBranch(headRef);
  const commitHash = getRepositoryStateHeadCommit(event);

  // Create repository pointer (kind 30617)
  const repoPointer = repoId
    ? {
        kind: 30617,
        pubkey: event.pubkey,
        identifier: repoId,
      }
    : null;

  const shortHash = commitHash?.substring(0, 8) || "unknown";
  const branchName = branch || "unknown";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Push notification */}
        <div className="flex items-center gap-2 flex-wrap text-sm font-medium text-foreground">
          <GitCommit className="size-4 text-muted-foreground flex-shrink-0" />
          <ClickableEventTitle event={event} className="" as="span">
            pushed{" "}
            <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
              {shortHash}
            </code>{" "}
            to
          </ClickableEventTitle>{" "}
          <Label className="inline">{branchName}</Label> in{" "}
          {repoPointer ? (
            <RepositoryLink
              repoPointer={repoPointer}
              inline
              className="inline-flex font-semibold"
            />
          ) : (
            <span className="font-semibold">{repoId || "repository"}</span>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
