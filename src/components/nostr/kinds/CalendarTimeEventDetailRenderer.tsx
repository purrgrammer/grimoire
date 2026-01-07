import type { NostrEvent } from "@/types/nostr";
import {
  parseTimeCalendarEvent,
  getTimeEventStatus,
  formatTimeRange,
  type CalendarEventStatus,
} from "@/lib/calendar-event";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import {
  CalendarClock,
  MapPin,
  Users,
  Clock,
  CheckCircle,
  Hash,
  ExternalLink,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Status badge for calendar events (larger variant for detail view)
 */
function CalendarStatusBadge({ status }: { status: CalendarEventStatus }) {
  const config = {
    upcoming: {
      label: "Upcoming",
      className: "bg-blue-600 text-white",
      icon: Clock,
    },
    ongoing: {
      label: "Happening Now",
      className: "bg-green-600 text-white",
      icon: CalendarClock,
    },
    past: {
      label: "Past Event",
      className: "bg-neutral-600 text-white",
      icon: CheckCircle,
    },
  }[status];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "rounded px-3 py-1.5 text-sm font-bold flex items-center gap-2 flex-shrink-0",
        config.className,
      )}
    >
      <Icon className="w-4 h-4" />
      <span>{config.label}</span>
    </div>
  );
}

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
        {/* Status and Time */}
        <div className="flex items-center gap-3 flex-wrap">
          <CalendarStatusBadge status={status} />
          {timeRange && (
            <span className="text-lg font-medium text-muted-foreground">
              {timeRange}
            </span>
          )}
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

        {/* Title */}
        <h1 className="text-3xl font-bold">
          {parsed.title || "Untitled Event"}
        </h1>

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
                    <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded">
                      {participant.role}
                    </span>
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
                <span
                  key={tag}
                  className="px-2 py-1 text-sm bg-muted text-muted-foreground rounded"
                >
                  #{tag}
                </span>
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
