import { useMemo } from "react";
import { FolderGit2 } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";
import { cn } from "@/lib/utils";

interface RepoPointer {
  kind: number;
  pubkey: string;
  identifier: string;
}

interface RepositoryLinkProps {
  /** Repository address in "kind:pubkey:identifier" format */
  repoAddress?: string;
  /** Direct repository pointer (takes precedence over repoAddress) */
  repoPointer?: RepoPointer | null;
  /** Additional CSS classes */
  className?: string;
  /** Icon size class (default: "size-3") */
  iconSize?: string;
  /** Whether to show inline (no wrapping div) */
  inline?: boolean;
  /** Whether to show the icon */
  showIcon?: boolean;
}

/**
 * Reusable repository link component for git-related events.
 * Fetches repository metadata and renders a clickable link.
 */
export function RepositoryLink({
  repoAddress,
  repoPointer: externalPointer,
  className,
  iconSize = "size-3",
  inline = false,
  showIcon = true,
}: RepositoryLinkProps) {
  const { addWindow } = useGrimoire();

  // Parse repository address to get the pointer (if not provided directly)
  const repoPointer = useMemo(() => {
    if (externalPointer) return externalPointer;
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
  }, [externalPointer, repoAddress]);

  // Fetch the repository event to get its name
  const repoEvent = useNostrEvent(repoPointer || undefined);

  // Get repository display name
  const repoName = useMemo(() => {
    if (repoEvent) {
      return (
        getRepositoryName(repoEvent) ||
        getRepositoryIdentifier(repoEvent) ||
        "Repository"
      );
    }
    // Fall back to identifier from address or pointer
    if (repoPointer?.identifier) return repoPointer.identifier;
    if (repoAddress) return repoAddress.split(":")[2] || "Unknown Repository";
    return "Unknown Repository";
  }, [repoEvent, repoPointer, repoAddress]);

  const handleClick = () => {
    if (!repoPointer) return;
    addWindow("open", { pointer: repoPointer });
  };

  if (!repoAddress && !externalPointer) return null;

  const linkContent = (
    <>
      {showIcon && <FolderGit2 className={cn(iconSize, "flex-shrink-0")} />}
      <span>{repoName}</span>
    </>
  );

  const baseClasses =
    "flex items-center gap-1 text-muted-foreground cursor-crosshair underline decoration-dotted hover:text-primary";

  if (inline) {
    return (
      <span onClick={handleClick} className={cn(baseClasses, className)}>
        {linkContent}
      </span>
    );
  }

  return (
    <div onClick={handleClick} className={cn(baseClasses, className)}>
      {linkContent}
    </div>
  );
}
