import { useState } from "react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./kinds";
import { UserName } from "./UserName";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuotedEventProps {
  /** Event ID string for regular events */
  eventId?: string;
  /** AddressPointer for addressable/replaceable events */
  addressPointer?: { kind: number; pubkey: string; identifier: string };
  /** Callback when user clicks to open the event in new window */
  onOpen?: (
    id: string | { kind: number; pubkey: string; identifier: string },
  ) => void;
  /** Depth level for nesting (0 = root, 1 = first quote, 2+ = nested) */
  depth?: number;
  /** Optional className for container */
  className?: string;
}

/**
 * QuotedEvent component with depth-aware rendering
 * - depth 0-1: Show full content inline by default
 * - depth 2+: Show expandable preview only
 */
export function QuotedEvent({
  eventId,
  addressPointer,
  onOpen,
  depth = 1,
  className,
}: QuotedEventProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  // Determine pointer to use
  const pointer = eventId || addressPointer;

  // Load the event
  const event = useNostrEvent(pointer);

  // Loading state
  if (!event) {
    if (onOpen && pointer) {
      const displayText =
        typeof eventId === "string"
          ? `@${eventId.slice(0, 8)}...`
          : addressPointer
            ? `@${addressPointer.identifier || addressPointer.kind}`
            : "@event";

      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onOpen(pointer);
          }}
          className="inline-flex items-center gap-1 text-accent underline decoration-dotted break-all"
        >
          <span>{displayText}</span>
        </a>
      );
    }

    return (
      <span className="text-sm text-muted-foreground italic">
        Loading event...
      </span>
    );
  }

  // For depth 0-1: Show full content inline by default
  if (depth < 2) {
    return (
      <div
        className={cn("my-2 border-l-2 border-muted pl-3 text-sm", className)}
      >
        <KindRenderer event={event} depth={depth + 1} />
      </div>
    );
  }

  // For depth 2+: Show expandable preview
  const previewText = event.content?.slice(0, 100) || "";
  const hasMore = event.content?.length > 100;

  return (
    <div
      className={cn(
        "my-2 border border-muted rounded-lg overflow-hidden",
        className,
      )}
    >
      {/* Preview header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-2 p-2 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <UserName pubkey={event.pubkey} className="text-xs font-medium" />
          <span className="text-xs text-muted-foreground truncate">
            {previewText}
            {hasMore && "..."}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="size-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="size-3 flex-shrink-0" />
        )}
      </button>

      {/* Full content - shown when expanded */}
      {isExpanded && (
        <div className="p-3 border-t border-muted">
          <KindRenderer event={event} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}
