import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { GitBranch, Globe } from "lucide-react";
import {
  getRepositoryName,
  getRepositoryDescription,
  getWebUrls,
} from "@/lib/nip34-helpers";
import { getReplaceableIdentifier } from "applesauce-core/helpers";

/**
 * Renderer for Kind 30617 - Repository
 * Displays as a compact repository card in feed view
 */
export function Kind30617Renderer({ event }: BaseEventProps) {
  const name = getRepositoryName(event);
  const description = getRepositoryDescription(event);
  const identifier = getReplaceableIdentifier(event);
  const webUrls = getWebUrls(event);

  // Use name if available, otherwise use identifier, fallback to "Repository"
  const displayName = name || identifier || "Repository";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Repository Info */}
        <div className="flex flex-col gap-2">
          {/* Name and Owner */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-muted-foreground flex-shrink-0" />
              <span className="text-lg font-semibold text-foreground">
                {displayName}
              </span>
            </div>
          </div>

          {/* Description */}
          {description && (
            <p className="text-sm text-muted-foreground line-clamp-3">
              {description}
            </p>
          )}

          {/* URLs and Maintainers */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {/* First Web URL */}
            {webUrls.length > 0 && (
              <a
                href={webUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-muted-foreground underline decoration-dotted cursor-crosshair line-clamp-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Globe className="size-3" />
                <span className="truncate line-clamp-1">{webUrls[0]}</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </BaseEventContainer>
  );
}
