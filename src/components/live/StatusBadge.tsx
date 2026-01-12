import { Circle, Calendar, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveStatus } from "@/types/live-activity";

interface StatusBadgeProps {
  status: LiveStatus;
  size?: "xs" | "sm" | "md";
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
    xs: "px-1.5 py-0.5 text-[10px] gap-0.5",
    sm: "px-2 py-1 text-xs gap-1",
    md: "px-3 py-1.5 text-sm gap-2",
  };

  const iconSizeClasses = {
    xs: "w-2.5 h-2.5",
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
