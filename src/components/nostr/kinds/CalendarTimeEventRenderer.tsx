import {
  parseTimeCalendarEvent,
  getTimeEventStatus,
  formatTimeRange,
  type CalendarEventStatus,
} from "@/lib/calendar-event";
import {
  BaseEventContainer,
  ClickableEventTitle,
  type BaseEventProps,
} from "./BaseEventRenderer";
import { Label } from "@/components/ui/label";
import { CalendarClock, MapPin, Users, Clock, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Status badge for calendar events
 */
function CalendarStatusBadge({
  status,
  size = "sm",
}: {
  status: CalendarEventStatus;
  size?: "sm" | "md";
}) {
  const config = {
    upcoming: {
      label: "UPCOMING",
      className: "bg-blue-600 text-white",
      icon: Clock,
    },
    ongoing: {
      label: "NOW",
      className: "bg-green-600 text-white",
      icon: CalendarClock,
    },
    past: {
      label: "PAST",
      className: "bg-neutral-600 text-white",
      icon: CheckCircle,
    },
  }[status];

  const Icon = config.icon;

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs gap-1",
    md: "px-3 py-1 text-sm gap-2",
  };

  const iconSizeClasses = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
  };

  return (
    <div
      className={cn(
        "rounded font-bold flex items-center flex-shrink-0",
        config.className,
        sizeClasses[size],
      )}
    >
      <Icon className={iconSizeClasses[size]} />
      <span>{config.label}</span>
    </div>
  );
}

/**
 * Renderer for Kind 31923 - Time-Based Calendar Event
 * Displays event title, time range with timezone, location, and participant count in feed
 */
export function CalendarTimeEventRenderer({ event }: BaseEventProps) {
  const parsed = parseTimeCalendarEvent(event);
  const status = getTimeEventStatus(parsed);
  const timeRange = formatTimeRange(
    parsed.start,
    parsed.end,
    parsed.startTzid,
    parsed.endTzid,
  );

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="text-lg font-semibold text-foreground"
        >
          {parsed.title || "Untitled Event"}
        </ClickableEventTitle>

        {/* Time and status: time left, badge right */}
        <div className="flex items-center justify-between">
          {timeRange && (
            <span className="text-xs text-muted-foreground">{timeRange}</span>
          )}
          <CalendarStatusBadge status={status} />
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
