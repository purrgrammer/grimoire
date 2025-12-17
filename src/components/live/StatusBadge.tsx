import { Circle, Calendar, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveStatus } from "@/types/live-activity";

interface StatusBadgeProps {
  status: LiveStatus;
  size?: "sm" | "md";
  hideLabel?: boolean;
}

export function StatusBadge({
  status,
  size = "sm",
  hideLabel = false,
}: StatusBadgeProps) {
  const config = {
    live: {
      label: "LIVE",
      className: "bg-red-600 text-white",
      icon: Circle,
    },
    planned: {
      label: "UPCOMING",
      className: "bg-blue-600 text-white",
      icon: Calendar,
    },
    ended: {
      label: "ENDED",
      className: "bg-neutral-600 text-white",
      icon: Video,
    },
  }[status];

  const Icon = config.icon;

  const sizeClasses = {
    sm: "px-2 py-1 text-xs gap-1",
    md: "px-3 py-1.5 text-sm gap-2",
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
      <Icon className={iconSizeClasses[size]} fill="currentColor" />
      {hideLabel ? null : <span>{config.label}</span>}
    </div>
  );
}
