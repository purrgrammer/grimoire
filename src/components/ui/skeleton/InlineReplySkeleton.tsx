import * as React from "react";
import { Skeleton } from "./Skeleton";

export interface InlineReplySkeletonProps {
  /** Icon to show on the left (Reply, MessageCircle, etc.) */
  icon: React.ReactNode;
  className?: string;
}

/**
 * Inline skeleton for loading parent message previews
 * Matches the exact structure and spacing of the reply box
 */
const InlineReplySkeleton = React.forwardRef<
  HTMLDivElement,
  InlineReplySkeletonProps
>(({ icon, className }, ref) => {
  return (
    <div
      ref={ref}
      className={`flex items-start gap-2 p-1 bg-muted/20 text-xs text-muted-foreground rounded ${className || ""}`}
      role="status"
      aria-label="Loading parent message..."
    >
      {/* Icon - visible during loading */}
      {React.isValidElement(icon) ? (
        <div className="size-3 flex-shrink-0 mt-0.5">{icon}</div>
      ) : null}

      {/* Content placeholder - matches text line-height */}
      <div className="flex-1 min-w-0 py-0.5">
        <Skeleton variant="text" width="70%" className="h-3" />
      </div>
    </div>
  );
});

InlineReplySkeleton.displayName = "InlineReplySkeleton";

export { InlineReplySkeleton };
