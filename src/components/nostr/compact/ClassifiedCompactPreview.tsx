import type { NostrEvent } from "@/types/nostr";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import {
  formatClassifiedPriceShort,
  parseClassified,
} from "@/lib/nip99-helpers";

/**
 * One-line preview for NIP-99 listings (30402) and drafts/inactive (30403):
 *
 *   [state]  [title]  [price / frequency]  [location]
 *
 * Always a single line. The title is the only foreground text and the only
 * part that truncates freely; the price keeps its width up to 40% of the
 * preview; the location is context and appears only once the preview is wide
 * enough (a container query — a tiled window can be phone-narrow). The state
 * word is short and shown only when the listing declares one, or is a 30403.
 *
 * The row opens the event, as every compact row does; nothing here is a
 * second click target, and nothing is fetched. Tag values render as text.
 */
export function ClassifiedCompactPreview({ event }: { event: NostrEvent }) {
  const { locale } = useGrimoire();
  const classified = parseClassified(event);
  const { title, summary, price, status, isDraft, location } = classified;
  const heading = title || summary;

  const state = isDraft
    ? "draft"
    : status?.type === "sold"
      ? "sold"
      : status?.type === "other"
        ? status.value
        : undefined;

  return (
    <span className="@container flex w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm">
      {state && (
        <span
          className={cn(
            "max-w-[25%] shrink-0 truncate",
            state === "sold" ? "text-destructive" : "text-muted-foreground",
            isDraft && "text-amber-600 dark:text-amber-400",
          )}
          title={isDraft ? "Draft or inactive listing (kind 30403)" : state}
        >
          {state}
        </span>
      )}
      <span
        className={cn(
          "min-w-0 truncate",
          heading ? "text-foreground" : "italic text-muted-foreground",
        )}
        title={heading}
      >
        {heading || "Untitled listing"}
      </span>
      {price && (
        <span
          className={cn(
            "max-w-[40%] shrink-0 truncate tabular-nums text-muted-foreground",
            status?.type === "sold" && "line-through",
          )}
        >
          {formatClassifiedPriceShort(price, locale.locale)}
        </span>
      )}
      {location && (
        <span className="hidden min-w-0 flex-[1_1_0] truncate text-muted-foreground @sm:block">
          {location}
        </span>
      )}
    </span>
  );
}
