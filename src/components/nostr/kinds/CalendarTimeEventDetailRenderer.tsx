import type { NostrEvent } from "@/types/nostr";
import {
  parseTimeCalendarEvent,
  getTimeEventStatus,
  formatTimeRange,
} from "@/lib/calendar-event";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import { CalendarStatusBadge } from "../calendar/CalendarStatusBadge";
import { Label } from "@/components/ui/label";
import { MapPin, Users, Hash, ExternalLink, Globe } from "lucide-react";

/**
 * Detail renderer for Kind 31923 - Time-Based Calendar Event
 * Displays full event details with participant list and timezone info
 */
export function CalendarTimeEventDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const parsed = parseTimeCalendarEvent(event);
  const status = getTimeEventStatus(parsed);
  const timeRange = formatTimeRange(
    parsed.start,
    parsed.end,
    parsed.startTzid,
    parsed.endTzid,
  );

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Event Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        {/* Title */}
        <h1 className="text-3xl font-bold">
          {parsed.title || parsed.identifier}
        </h1>

        {/* Time and Status: time left, badge right */}
        <div className="flex items-center justify-between">
          {timeRange && (
            <span className="text-sm text-muted-foreground">{timeRange}</span>
          )}
          <CalendarStatusBadge status={status} variant="time" size="md" />
        </div>

        {/* Timezone indicator */}
        {parsed.startTzid && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="w-4 h-4" />
            <span>{parsed.startTzid}</span>
            {parsed.endTzid && parsed.endTzid !== parsed.startTzid && (
              <span className="text-muted-foreground/70">
                (ends in {parsed.endTzid})
              </span>
            )}
          </div>
        )}

        {/* Organizer */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Organized by</span>
          <UserName pubkey={event.pubkey} className="font-semibold" />
        </div>
      </header>

      {/* Event Details */}
      <div className="flex flex-col gap-6">
        {/* Locations */}
        {parsed.locations.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Location{parsed.locations.length > 1 ? "s" : ""}
            </h2>
            <ul className="flex flex-col gap-1">
              {parsed.locations.map((location, i) => (
                <li key={i} className="text-foreground">
                  {location}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Description */}
        {parsed.description && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              About this event
            </h2>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownContent content={parsed.description} />
            </div>
          </section>
        )}

        {/* Participants */}
        {parsed.participants.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Users className="w-4 h-4" />
              Participants ({parsed.participants.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {parsed.participants.map((participant) => (
                <li
                  key={participant.pubkey}
                  className="flex items-center gap-2"
                >
                  <UserName pubkey={participant.pubkey} />
                  {participant.role && (
                    <Label size="sm">{participant.role}</Label>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Hashtags */}
        {parsed.hashtags.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Hash className="w-4 h-4" />
              Tags
            </h2>
            <div className="flex flex-wrap gap-2">
              {parsed.hashtags.map((tag) => (
                <Label key={tag} size="sm">
                  {tag}
                </Label>
              ))}
            </div>
          </section>
        )}

        {/* References */}
        {parsed.references.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Links
            </h2>
            <ul className="flex flex-col gap-1">
              {parsed.references.map((ref, i) => (
                <li key={i}>
                  <a
                    href={ref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline truncate block"
                  >
                    {ref}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
