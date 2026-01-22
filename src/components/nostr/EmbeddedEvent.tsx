import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./kinds";
import { EventCardSkeleton } from "@/components/ui/skeleton";

interface EmbeddedEventProps {
  /** EventPointer with optional relay hints for regular events */
  eventPointer?: EventPointer;
  /** AddressPointer for addressable/replaceable events (includes relay hints) */
  addressPointer?: AddressPointer;
  /** Callback when user clicks to open the event in new window */
  onOpen?: (id: string | AddressPointer) => void;
  /** Optional loading fallback */
  loadingFallback?: React.ReactNode;
  /** Optional className for container */
  className?: string;
}

/**
 * Reusable component for embedding Nostr events
 * Handles loading state and displays the embedded event using KindRenderer
 * Passes full pointer (including relay hints) for proper event resolution
 */
export function EmbeddedEvent({
  eventPointer,
  addressPointer,
  onOpen,
  loadingFallback,
  className = "my-4 border border-muted rounded overflow-hidden",
}: EmbeddedEventProps) {
  // Determine pointer to use - full pointer preserves relay hints
  const pointer = eventPointer || addressPointer;

  // Load the event - passes full pointer with relay hints to useNostrEvent
  const event = useNostrEvent(pointer);

  // If event loaded, render it
  if (event) {
    return (
      <div className={className}>
        <KindRenderer event={event} />
      </div>
    );
  }

  // If loading and we have a fallback, show it
  if (loadingFallback) {
    return <>{loadingFallback}</>;
  }

  // Default loading state - show clickable link if onOpen provided
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
          onOpen(eventPointer?.id || addressPointer!);
        }}
        className="inline-flex items-center gap-1 text-accent underline decoration-dotted break-all"
      >
        <span>{displayText}</span>
      </a>
    );
  }

  // No onOpen handler - show skeleton
  return (
    <div className={className}>
      <EventCardSkeleton variant="compact" />
    </div>
  );
}
