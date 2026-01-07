import {
  parseDateCalendarEvent,
  getDateEventStatus,
  formatDateRange,
} from "@/lib/calendar-event";
import {
  BaseEventContainer,
  ClickableEventTitle,
  type BaseEventProps,
} from "./BaseEventRenderer";
import { CalendarStatusBadge } from "../calendar/CalendarStatusBadge";
import { Label } from "@/components/ui/label";
import { MapPin, Users } from "lucide-react";

/**
 * Renderer for Kind 31922 - Date-Based Calendar Event
 * Displays event title, date range, location, and participant count in feed
 */
export function CalendarDateEventRenderer({ event }: BaseEventProps) {
  const parsed = parseDateCalendarEvent(event);
  const status = getDateEventStatus(parsed);
  const dateRange = formatDateRange(parsed.start, parsed.end);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="text-lg font-semibold text-foreground"
        >
          {parsed.title || parsed.identifier}
        </ClickableEventTitle>

        {/* Date and status: time left, badge right */}
        <div className="flex items-center justify-between">
          {dateRange && (
            <span className="text-xs text-muted-foreground">{dateRange}</span>
          )}
          <CalendarStatusBadge status={status} variant="date" size="sm" />
        </div>

        {/* Description preview */}
        {parsed.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {parsed.description}
          </p>
        )}

        {/* Location and participants */}
        {(parsed.locations.length > 0 || parsed.participants.length > 0) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {/* Location */}
            {parsed.locations.length > 0 && (
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                <span className="truncate max-w-[200px]">
                  {parsed.locations[0]}
                  {parsed.locations.length > 1 &&
                    ` +${parsed.locations.length - 1}`}
                </span>
              </div>
            )}

            {/* Participant count */}
            {parsed.participants.length > 0 && (
              <div className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                <span>
                  {parsed.participants.length}{" "}
                  {parsed.participants.length === 1
                    ? "participant"
                    : "participants"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Hashtags */}
        {parsed.hashtags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {parsed.hashtags.slice(0, 3).map((tag) => (
              <Label key={tag} size="sm">
                {tag}
              </Label>
            ))}
            {parsed.hashtags.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{parsed.hashtags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
