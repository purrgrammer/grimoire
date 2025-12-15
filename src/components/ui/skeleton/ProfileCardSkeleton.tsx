import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Skeleton } from "./Skeleton";

const profileCardSkeletonVariants = cva("flex flex-col gap-4", {
  variants: {
    variant: {
      full: "",
      compact: "",
      inline: "flex-row items-baseline gap-2",
    },
  },
  defaultVariants: {
    variant: "full",
  },
});

export interface ProfileCardSkeletonProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof profileCardSkeletonVariants> {
  showBio?: boolean;
  showNip05?: boolean;
}

const ProfileCardSkeleton = React.forwardRef<
  HTMLDivElement,
  ProfileCardSkeletonProps
>(
  (
    { className, variant = "full", showBio = true, showNip05 = true, ...props },
    ref,
  ) => {
    // Name height based on variant (ProfileViewer uses 2xl font)
    const nameHeight = variant === "full" ? 32 : 16;
    const nameWidth = variant === "full" ? "16rem" : "8rem";

    return (
      <div
        ref={ref}
        className={profileCardSkeletonVariants({ variant, className })}
        role="status"
        aria-label="Loading profile..."
        {...props}
      >
        {/* Name */}
        <Skeleton variant="text" width={nameWidth} height={nameHeight} />

        {/* NIP-05 (optional, only for full variant) */}
        {showNip05 && variant === "full" && (
          <Skeleton variant="text" width="12rem" height={12} />
        )}

        {/* Bio (only for full and compact variants) */}
        {showBio && variant !== "inline" && (
          <div className="space-y-2">
            {variant === "full" && (
              <Skeleton variant="text" width="3rem" height={10} />
            )}
            <Skeleton variant="text" width="100%" height={14} />
            <Skeleton variant="text" width="95%" height={14} />
            {variant === "full" && (
              <Skeleton variant="text" width="85%" height={14} />
            )}
          </div>
        )}
      </div>
    );
  },
);

ProfileCardSkeleton.displayName = "ProfileCardSkeleton";

export { ProfileCardSkeleton, profileCardSkeletonVariants };
