import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Skeleton } from "./Skeleton";

const eventCardSkeletonVariants = cva("flex flex-col gap-2", {
  variants: {
    variant: {
      default: "",
      compact: "",
      detailed: "",
    },
    timeline: {
      true: "p-3 border-b border-border/50",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    timeline: false,
  },
});

export interface EventCardSkeletonProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof eventCardSkeletonVariants> {
  showActions?: boolean;
  isLast?: boolean;
}

const EventCardSkeleton = React.forwardRef<
  HTMLDivElement,
  EventCardSkeletonProps
>(
  (
    {
      className,
      variant = "default",
      timeline = false,
      showActions = true,
      isLast = false,
      ...props
    },
    ref,
  ) => {
    // Content line count based on variant
    const contentLines =
      variant === "compact" ? 2 : variant === "detailed" ? 6 : 4;

    return (
      <div
        ref={ref}
        className={`${eventCardSkeletonVariants({ variant, timeline })} ${timeline && isLast ? "border-0" : ""} ${className || ""}`}
        role="status"
        aria-label="Loading event..."
        {...props}
      >
        {/* Header: Name + Timestamp (matches BaseEventContainer) */}
        <div className="flex flex-row justify-between items-center">
          <div className="flex flex-row gap-2 items-baseline">
            <Skeleton variant="text" width="8rem" height={16} />
            <Skeleton variant="text" width="4rem" height={12} />
          </div>
          {/* Menu placeholder */}
          <Skeleton variant="rectangle" width={20} height={20} />
        </div>

        {/* Content */}
        <div className="space-y-2">
          {Array.from({ length: contentLines }).map((_, i) => (
            <Skeleton
              key={i}
              variant="text"
              width={i === contentLines - 1 ? "70%" : "100%"}
              height={14}
            />
          ))}
        </div>

        {/* Footer: Action buttons */}
        {showActions && (
          <div className="flex gap-4">
            <Skeleton variant="text" width="3rem" height={12} />
            <Skeleton variant="text" width="3rem" height={12} />
            <Skeleton variant="text" width="3rem" height={12} />
          </div>
        )}
      </div>
    );
  },
);

EventCardSkeleton.displayName = "EventCardSkeleton";

export { EventCardSkeleton, eventCardSkeletonVariants };
