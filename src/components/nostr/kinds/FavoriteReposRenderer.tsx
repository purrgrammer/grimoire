import { FolderGit2, GitBranch } from "lucide-react";
import { getAddressPointers } from "@/lib/nostr-utils";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { EventRefListFull } from "../lists";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useAddWindow } from "@/core/state";
import { getRepositoryName } from "@/lib/nip34-helpers";
import { getReplaceableIdentifier } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";
import type { AddressPointer } from "nostr-tools/nip19";

/**
 * Clickable repo name that loads and displays the repository name
 */
function RepoNameItem({ pointer }: { pointer: AddressPointer }) {
  const event = useNostrEvent(pointer);
  const addWindow = useAddWindow();

  const displayName = event
    ? getRepositoryName(event) ||
      getReplaceableIdentifier(event) ||
      "Repository"
    : pointer.identifier || "Loading...";

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    addWindow("open", { pointer });
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 text-xs text-foreground hover:text-foreground cursor-crosshair transition-colors"
    >
      <GitBranch className="size-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="hover:underline hover:decoration-dotted truncate">
        {displayName}
      </span>
    </button>
  );
}

/**
 * Kind 10018 Renderer - Favorite Repositories (Feed View)
 */
export function FavoriteReposRenderer({ event }: BaseEventProps) {
  const pointers = getAddressPointers(event).filter((p) => p.kind === 30617);

  if (pointers.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No favorite repositories
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <FolderGit2 className="size-4 text-muted-foreground" />
          <span>Favorite Repositories ({pointers.length})</span>
        </ClickableEventTitle>

        <div className="flex flex-col gap-1">
          {pointers.map((pointer) => (
            <RepoNameItem
              key={`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`}
              pointer={pointer}
            />
          ))}
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10018 Detail Renderer - Favorite Repositories (Full View)
 */
export function FavoriteReposDetailRenderer({ event }: { event: NostrEvent }) {
  const pointers = getAddressPointers(event).filter((p) => p.kind === 30617);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <FolderGit2 className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Favorite Repositories</span>
        <span className="text-sm text-muted-foreground">
          ({pointers.length})
        </span>
      </div>

      {pointers.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">
          No favorite repositories yet
        </div>
      ) : (
        <EventRefListFull
          addressPointers={pointers}
          label="Repositories"
          icon={<GitBranch className="size-5" />}
        />
      )}
    </div>
  );
}
