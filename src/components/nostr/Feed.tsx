import { useTimeline } from "@/hooks/useTimeline";
import { kinds } from "nostr-tools";
import { NostrEvent } from "@/types/nostr";
import { KindRenderer } from "./kinds";
import { EventErrorBoundary } from "../EventErrorBoundary";

interface FeedEventProps {
  event: NostrEvent;
}

/**
 * FeedEvent - Renders a single event using the appropriate kind renderer
 * Wrapped in error boundary to prevent one broken event from crashing the feed
 */
export function FeedEvent({ event }: FeedEventProps) {
  return (
    <EventErrorBoundary event={event}>
      <KindRenderer event={event} />
    </EventErrorBoundary>
  );
}

/**
 * Feed - Main feed component displaying timeline of events
 */
export default function Feed({ className }: { className?: string }) {
  const relays = ["wss://theforest.nostr1.com"];
  const { events } = useTimeline(
    "feed-forest",
    {
      kinds: [kinds.ShortTextNote],
    },
    relays,
    {
      limit: 200,
    },
  );

  return (
    <div className={className}>
      {events.map((e) => (
        <FeedEvent key={e.id} event={e} />
      ))}
    </div>
  );
}
