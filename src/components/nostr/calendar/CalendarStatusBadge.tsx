import type { LucideIcon } from "lucide-react";
import { Clock, CheckCircle, CalendarDays, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEventStatus } from "@/lib/calendar-event";

interface StatusConfig {
  label: string;
  className: string;
  icon: LucideIcon;
}

const STATUS_CONFIG: Record<
  CalendarEventStatus,
  { label: string; className: string }
> = {
  upcoming: { label: "upcoming", className: "text-blue-500" },
  ongoing: { label: "now", className: "text-green-500" },
  past: { label: "past", className: "text-muted-foreground" },
};

interface CalendarStatusBadgeProps {
  status: CalendarEventStatus;
  /** Icon variant - use CalendarDays for date events, CalendarClock for time events */
  variant?: "date" | "time";
  /** Size variant - sm for feed, md for detail views */
  size?: "sm" | "md";
}

/**
 * Status badge for calendar events (NIP-52)
 * Displays the current status (upcoming/now/past) with an appropriate icon
 */
export function CalendarStatusBadge({
  status,
  variant = "date",
  size = "sm",
}: CalendarStatusBadgeProps) {
  const baseConfig = STATUS_CONFIG[status];
  const OngoingIcon = variant === "time" ? CalendarClock : CalendarDays;

  const config: StatusConfig = {
    ...baseConfig,
    icon:
      status === "ongoing"
        ? OngoingIcon
        : status === "upcoming"
          ? Clock
          : CheckCircle,
  };

  const Icon = config.icon;

  const sizeClasses = {
    sm: { text: "text-xs", icon: "w-3 h-3", gap: "gap-1" },
    md: { text: "text-sm", icon: "w-4 h-4", gap: "gap-1" },
  }[size];

  return (
    <div
      className={cn(
        "flex items-center flex-shrink-0",
        sizeClasses.text,
        sizeClasses.gap,
        config.className,
      )}
    >
      <Icon className={sizeClasses.icon} />
      <span>{config.label}</span>
    </div>
  );
}
