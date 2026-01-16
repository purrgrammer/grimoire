import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { DetailKindRenderer } from "./nostr/kinds";
import { EventErrorBoundary } from "./EventErrorBoundary";
import { EventDetailSkeleton } from "@/components/ui/skeleton";
import { BookOpen } from "lucide-react";

export interface WikiViewerProps {
  subject: string; // Normalized subject (d-tag)
}

/**
 * WikiViewer - Displays a wiki article by subject (NIP-54)
 * Fetches and displays the latest kind 30818 event with the given d-tag
 */
export function WikiViewer({ subject }: WikiViewerProps) {
  // Query for kind 30818 wiki articles with this subject
  // Kind 30818 is replaceable, so eventStore will automatically return the latest version
  const events = use$(
    () =>
      eventStore.timeline({
        kinds: [30818],
        "#d": [subject],
      }),
    [subject],
  );

  // Get the first (and should be only) event from the array
  // For replaceable events, eventStore returns only the latest version
  const event = events && events.length > 0 ? events[0] : null;

  // Loading state
  if (!event) {
    return (
      <div className="flex flex-col h-full p-8">
        <div className="flex items-center gap-2 text-muted-foreground mb-4">
          <BookOpen className="size-5" />
          <span className="text-sm">Loading wiki article...</span>
        </div>
        <EventDetailSkeleton />
      </div>
    );
  }

  // Render the wiki article using the detail renderer
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <EventErrorBoundary event={event}>
        <DetailKindRenderer event={event} />
      </EventErrorBoundary>
    </div>
  );
}
