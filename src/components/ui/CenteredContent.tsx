import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CenteredContentProps {
  children: ReactNode;
  /**
   * Maximum width of the centered content
   * @default '3xl' (48rem / 768px)
   */
  maxWidth?:
    "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "full";
  /**
   * Vertical spacing between child elements
   * @default '6' (1.5rem)
   */
  spacing?: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "8" | "10" | "12";
  /**
   * Padding around the content
   * @default '6' (1.5rem)
   */
  padding?: "0" | "2" | "4" | "6" | "8";
  /**
   * Additional CSS classes for the inner content container
   */
  className?: string;
}

const maxWidthClasses = {
  sm: "max-w-sm", // 24rem / 384px
  md: "max-w-md", // 28rem / 448px
  lg: "max-w-lg", // 32rem / 512px
  xl: "max-w-xl", // 36rem / 576px
  "2xl": "max-w-2xl", // 42rem / 672px
  "3xl": "max-w-3xl", // 48rem / 768px - DEFAULT
  "4xl": "max-w-4xl", // 56rem / 896px
  "5xl": "max-w-5xl", // 64rem / 1024px
  "6xl": "max-w-6xl", // 72rem / 1152px
  full: "max-w-full", // No limit
} as const;

const spacingClasses = {
  "0": "space-y-0",
  "1": "space-y-1",
  "2": "space-y-2",
  "3": "space-y-3",
  "4": "space-y-4",
  "5": "space-y-5",
  "6": "space-y-6", // DEFAULT
  "8": "space-y-8",
  "10": "space-y-10",
  "12": "space-y-12",
} as const;

const paddingClasses = {
  "0": "p-0",
  "2": "p-2",
  "4": "p-4",
  "6": "p-6", // DEFAULT
  "8": "p-8",
} as const;

/**
 * CenteredContent - Reusable container for centered, max-width content
 *
 * Provides consistent layout pattern for documentation-style pages:
 * - Centered content with configurable max-width
 * - Consistent padding and spacing
 * - Works with WindowRenderer's scroll container
 *
 * @example
 * // Default (3xl width, 6 spacing, 6 padding)
 * <CenteredContent>
 *   {content}
 * </CenteredContent>
 *
 * @example
 * // Man pages (wider, tighter spacing)
 * <CenteredContent maxWidth="4xl" spacing="4" className="font-mono text-sm">
 *   {content}
 * </CenteredContent>
 *
 * @example
 * // No padding (rare)
 * <CenteredContent padding="0">
 *   {content}
 * </CenteredContent>
 */
export function CenteredContent({
  children,
  maxWidth = "3xl",
  spacing = "6",
  padding = "6",
  className,
}: CenteredContentProps) {
  return (
    <div className={paddingClasses[padding]}>
      <div
        className={cn(
          "mx-auto",
          maxWidthClasses[maxWidth],
          spacingClasses[spacing],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
