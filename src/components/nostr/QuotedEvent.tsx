import { useState } from "react";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./kinds";
import { UserName } from "./UserName";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { CompactQuoteSkeleton } from "@/components/ui/skeleton";

interface QuotedEventProps {
  /** EventPointer with optional relay hints for regular events */
  eventPointer?: EventPointer;
  /** AddressPointer for addressable/replaceable events (includes relay hints) */
  addressPointer?: AddressPointer;
  /** Callback when user clicks to open the event in new window */
  onOpen?: (id: string | AddressPointer) => void;
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
  eventPointer,
  addressPointer,
  onOpen,
  depth = 1,
  className,
}: QuotedEventProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  // Determine pointer to use - full pointer preserves relay hints
  const pointer = eventPointer || addressPointer;

  // Load the event - passes full pointer with relay hints to useNostrEvent
  const event = useNostrEvent(pointer);

  // Loading state
  if (!event) {
    if (onOpen && pointer) {
      const displayText = eventPointer
        ? `@${eventPointer.id.slice(0, 8)}...`
        : addressPointer
          ? `@${addressPointer.identifier || addressPointer.kind}`
          : "@event";

      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen(eventPointer?.id || addressPointer!);
          }}
          className="inline-flex items-center gap-1 text-accent underline decoration-dotted break-all"
        >
          <span>{displayText}</span>
        </a>
      );
    }

    return <CompactQuoteSkeleton className={className} />;
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
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
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
