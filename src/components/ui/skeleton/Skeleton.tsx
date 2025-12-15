import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

const skeletonVariants = cva("animate-skeleton-pulse bg-muted rounded", {
  variants: {
    variant: {
      circle: "rounded-full",
      rectangle: "rounded",
      text: "rounded h-4",
    },
  },
  defaultVariants: {
    variant: "rectangle",
  },
});

export interface SkeletonProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  width?: number | string;
  height?: number | string;
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant, width, height, style, ...props }, ref) => {
    const inlineStyle: React.CSSProperties = {
      ...style,
      ...(width !== undefined && {
        width: typeof width === "number" ? `${width}px` : width,
      }),
      ...(height !== undefined && {
        height: typeof height === "number" ? `${height}px` : height,
      }),
    };

    return (
      <div
        ref={ref}
        className={skeletonVariants({ variant, className })}
        style={inlineStyle}
        role="status"
        aria-busy="true"
        aria-label="Loading..."
        {...props}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";

export { Skeleton, skeletonVariants };
