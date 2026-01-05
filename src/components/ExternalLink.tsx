import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExternalLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  iconClassName?: string;
  showIcon?: boolean;
  variant?: "default" | "muted";
  size?: "xs" | "sm" | "base";
}

/**
 * Reusable external link component with consistent styling across the app
 * Follows patterns from HighlightRenderer and BookmarkRenderer
 */
export function ExternalLink({
  href,
  children,
  className,
  iconClassName,
  showIcon = true,
  variant = "muted",
  size = "xs",
}: ExternalLinkProps) {
  const sizeClasses = {
    xs: "text-xs",
    sm: "text-sm",
    base: "text-base",
  };

  const iconSizeClasses = {
    xs: "size-3",
    sm: "size-3",
    base: "size-4",
  };

  const variantClasses = {
    default: "text-primary hover:underline",
    muted: "text-muted-foreground underline decoration-dotted",
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1",
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {showIcon && (
        <ExternalLinkIcon
          className={cn("flex-shrink-0", iconSizeClasses[size], iconClassName)}
        />
      )}
      <span className="truncate">{children}</span>
    </a>
  );
}
