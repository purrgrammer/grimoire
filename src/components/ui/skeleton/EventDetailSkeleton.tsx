import * as React from "react";
import { Skeleton } from "./Skeleton";

export type EventDetailSkeletonProps = React.HTMLAttributes<HTMLDivElement>;

const EventDetailSkeleton = React.forwardRef<
  HTMLDivElement,
  EventDetailSkeletonProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={className}
      role="status"
      aria-label="Loading event details..."
      {...props}
    >
      <div className="space-y-6">
        {/* Header: Name + timestamp (matches BaseEventContainer) */}
        <div className="flex flex-row gap-2 items-baseline">
          <Skeleton variant="text" width="10rem" height={18} />
          <Skeleton variant="text" width="6rem" height={14} />
        </div>

        {/* Event Content: 5 lines */}
        <div className="space-y-3">
          <Skeleton variant="text" width="100%" height={16} />
          <Skeleton variant="text" width="100%" height={16} />
          <Skeleton variant="text" width="95%" height={16} />
          <Skeleton variant="text" width="98%" height={16} />
          <Skeleton variant="text" width="85%" height={16} />
        </div>

        {/* Metadata Section */}
        <div className="space-y-2 pt-4 border-t border-border">
          <Skeleton variant="text" width="8rem" height={12} />
          <Skeleton variant="text" width="10rem" height={12} />
          <Skeleton variant="text" width="6rem" height={12} />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-4">
          <Skeleton variant="rectangle" width="5rem" height={36} />
          <Skeleton variant="rectangle" width="5rem" height={36} />
          <Skeleton variant="rectangle" width="5rem" height={36} />
        </div>
      </div>
    </div>
  );
});

EventDetailSkeleton.displayName = "EventDetailSkeleton";

export { EventDetailSkeleton };
