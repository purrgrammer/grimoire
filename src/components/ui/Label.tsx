import { cn } from "@/lib/utils";

interface LabelProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Size variant for the label
   * - sm: px-2 py-0.5 (default)
   * - md: px-3 py-1
   */
  size?: "sm" | "md";
}

/**
 * Label/Badge component with dotted border styling
 * Used for tags, language indicators, and metadata labels
 */
export function Label({ children, className, size = "sm" }: LabelProps) {
  return (
    <span
      className={cn(
        "border border-muted border-dotted text-muted-foreground text-xs",
        size === "sm" && "px-2 py-0.5",
        size === "md" && "px-3 py-1",
        className,
      )}
    >
      {children}
    </span>
  );
}
