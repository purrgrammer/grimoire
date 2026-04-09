import { ScrollText, Star } from "lucide-react";
import {
  getScrollName,
  getScrollParams,
  getScrollContentSize,
  getScrollIcon,
  formatBytes,
} from "@/lib/nip5c-helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { ScrollIconImage } from "./ScrollRenderer";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useFavoriteList, getListPointers } from "@/hooks/useFavoriteList";
import { FAVORITE_LISTS } from "@/config/favorite-lists";
import { SCROLL_KIND } from "@/constants/kinds";
import { useAccount } from "@/hooks/useAccount";
import { Skeleton } from "@/components/ui/skeleton";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer } from "nostr-tools/nip19";

/**
 * Individual scroll reference item for the detail view
 */
function ScrollRefItem({
  pointer,
  onUnfavorite,
  canModify,
}: {
  pointer: EventPointer;
  onUnfavorite?: (event: NostrEvent) => void;
  canModify: boolean;
}) {
  const scrollEvent = useNostrEvent(pointer);

  if (!scrollEvent) {
    return (
      <div className="flex items-center gap-3 p-3 border border-border/50 rounded">
        <Skeleton className="h-4 w-4 rounded" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48 mt-1" />
        </div>
      </div>
    );
  }

  const name = getScrollName(scrollEvent);
  const iconUrl = getScrollIcon(scrollEvent);
  const params = getScrollParams(scrollEvent);
  const contentSize = getScrollContentSize(scrollEvent);

  return (
    <div className="flex items-center gap-3 p-3 border border-border/50 rounded group hover:bg-muted/30 transition-colors">
      <ScrollIconImage iconUrl={iconUrl} className="size-4" />
      <div className="flex-1 min-w-0">
        <ClickableEventTitle
          event={scrollEvent}
          className="text-sm font-medium truncate flex items-center gap-1.5"
        >
          {name || "Unnamed Scroll"}
        </ClickableEventTitle>
        <div className="text-xs text-muted-foreground mt-0.5">
          {params.length > 0 && (
            <span>
              {params.length} param{params.length !== 1 ? "s" : ""}
            </span>
          )}
          {params.length > 0 && contentSize > 0 && <span> · </span>}
          {contentSize > 0 && <span>{formatBytes(contentSize)}</span>}
        </div>
      </div>
      {canModify && onUnfavorite && (
        <button
          onClick={() => onUnfavorite(scrollEvent)}
          className="p-1.5 text-muted-foreground hover:text-yellow-500 transition-colors flex-shrink-0"
          title="Remove from favorites"
        >
          <Star className="size-3.5 fill-current" />
        </button>
      )}
    </div>
  );
}

/**
 * Kind 10027 Renderer - Favorite Scrolls (Feed View)
 */
export function FavoriteScrollsRenderer({ event }: BaseEventProps) {
  const pointers = getListPointers(event, "e");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <ScrollText className="size-4 text-muted-foreground" />
          <span>Favorite Scrolls</span>
        </ClickableEventTitle>

        <div className="text-xs text-muted-foreground">
          {pointers.length === 0
            ? "No favorite scrolls"
            : `${pointers.length} favorite scroll${pointers.length !== 1 ? "s" : ""}`}
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10027 Detail Renderer - Favorite Scrolls (Full View)
 */
export function FavoriteScrollsDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const { canSign } = useAccount();
  const { toggleFavorite } = useFavoriteList(FAVORITE_LISTS[SCROLL_KIND]);

  const pointers = getListPointers(event, "e");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <ScrollText className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Favorite Scrolls</span>
        <span className="text-sm text-muted-foreground">
          ({pointers.length})
        </span>
      </div>

      {pointers.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">
          No favorite scrolls yet. Star a scroll to add it here.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pointers.map((pointer) => (
            <ScrollRefItem
              key={pointer.id}
              pointer={pointer}
              onUnfavorite={canSign ? toggleFavorite : undefined}
              canModify={canSign}
            />
          ))}
        </div>
      )}
    </div>
  );
}
