import * as React from "react";
import {
  EventCardSkeleton,
  type EventCardSkeletonProps,
} from "./EventCardSkeleton";

export interface TimelineSkeletonProps extends Omit<
  EventCardSkeletonProps,
  "className" | "isLast" | "timeline"
> {
  count?: number;
  className?: string;
}

const TimelineSkeleton = React.forwardRef<
  HTMLDivElement,
  TimelineSkeletonProps
>(
  (
    {
      count = 3,
      variant = "compact",
      showActions = false,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={className}
        role="status"
        aria-label="Loading timeline..."
      >
        {Array.from({ length: count }).map((_, i) => (
          <EventCardSkeleton
            key={i}
            variant={variant}
            showActions={showActions}
            timeline={true}
            isLast={i === count - 1}
            {...props}
          />
        ))}
      </div>
    );
  },
);

TimelineSkeleton.displayName = "TimelineSkeleton";

export { TimelineSkeleton };
