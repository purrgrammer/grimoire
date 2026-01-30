import { Copy, CopyCheck } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import { cn } from "@/lib/utils";

type IconSize = "xs" | "sm" | "md" | "lg";

interface IconCopyButtonProps {
  /** Text to copy to clipboard */
  text: string;
  /** Icon size preset */
  size?: IconSize;
  /** Additional class names for the button */
  className?: string;
  /** Tooltip/aria-label text */
  label?: string;
}

const sizeClasses: Record<IconSize, string> = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5 md:size-4",
};

/**
 * Tiny icon-only copy button for inline use
 * Uses Copy/CopyCheck icons with consistent styling
 */
export function IconCopyButton({
  text,
  size = "sm",
  className,
  label = "Copy",
}: IconCopyButtonProps) {
  const { copy, copied } = useCopy();

  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className={cn(
        "flex-shrink-0 p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {copied ? (
        <CopyCheck className={cn(sizeClasses[size], "text-success")} />
      ) : (
        <Copy className={sizeClasses[size]} />
      )}
    </button>
  );
}
