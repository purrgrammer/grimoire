import { FileText, User, Clock, Search, Hash } from "lucide-react";
import type { NostrFilter } from "@/types/nostr";

interface FilterSummaryBadgesProps {
  filter: NostrFilter;
  className?: string;
}

/**
 * Compact filter summary badges showing icons and counts
 * Used by ReqViewer and CountViewer headers
 */
export function FilterSummaryBadges({
  filter,
  className = "",
}: FilterSummaryBadgesProps) {
  const authorPubkeys = filter.authors || [];
  const pTagPubkeys = filter["#p"] || [];

  // Calculate tag count (excluding #p which is shown separately)
  const tagCount =
    (filter["#e"]?.length || 0) +
    (filter["#t"]?.length || 0) +
    (filter["#d"]?.length || 0) +
    Object.entries(filter)
      .filter(
        ([key]) =>
          key.startsWith("#") &&
          key.length === 2 &&
          !["#e", "#p", "#t", "#d", "#P"].includes(key),
      )
      .reduce((sum, [, values]) => sum + (values as string[]).length, 0);

  return (
    <div
      className={`flex items-center gap-4 text-xs text-muted-foreground flex-wrap ${className}`}
    >
      {filter.kinds && filter.kinds.length > 0 && (
        <span className="flex items-center gap-1.5">
          <FileText className="size-3.5" />
          {filter.kinds.length} kind{filter.kinds.length !== 1 ? "s" : ""}
        </span>
      )}
      {authorPubkeys.length > 0 && (
        <span className="flex items-center gap-1.5">
          <User className="size-3.5" />
          {authorPubkeys.length} author
          {authorPubkeys.length !== 1 ? "s" : ""}
        </span>
      )}
      {pTagPubkeys.length > 0 && (
        <span className="flex items-center gap-1.5">
          <User className="size-3.5" />
          {pTagPubkeys.length} mention{pTagPubkeys.length !== 1 ? "s" : ""}
        </span>
      )}
      {(filter.since || filter.until) && (
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" />
          time range
        </span>
      )}
      {filter.search && (
        <span className="flex items-center gap-1.5">
          <Search className="size-3.5" />
          search
        </span>
      )}
      {tagCount > 0 && (
        <span className="flex items-center gap-1.5">
          <Hash className="size-3.5" />
          {tagCount} tag{tagCount !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
