import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./kinds";
import { EventCardSkeleton } from "@/components/ui/skeleton";

interface EmbeddedEventProps {
  /** Event ID string for regular events */
  eventId?: string;
  /** AddressPointer for addressable/replaceable events */
  addressPointer?: { kind: number; pubkey: string; identifier: string };
  /** Callback when user clicks to open the event in new window */
  onOpen?: (
    id: string | { kind: number; pubkey: string; identifier: string },
  ) => void;
  /** Optional loading fallback */
  loadingFallback?: React.ReactNode;
  /** Optional className for container */
  className?: string;
}

/**
 * Reusable component for embedding Nostr events
 * Handles loading state and displays the embedded event using KindRenderer
 */
export function EmbeddedEvent({
  eventId,
  addressPointer,
  onOpen,
  loadingFallback,
  className = "my-4 border border-muted rounded overflow-hidden",
}: EmbeddedEventProps) {
  // Determine pointer to use
  const pointer = eventId || addressPointer;

  // Load the event
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

  // No onOpen handler - show skeleton
  return (
    <div className={className}>
      <EventCardSkeleton variant="compact" />
    </div>
  );
}
