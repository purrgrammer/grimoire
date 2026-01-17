import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export interface UnicodeEmojiProps {
  /** The emoji character */
  emoji: string;
  /** The shortcode for tooltip (without colons) */
  shortcode?: string;
  /** Size variant - matches CustomEmoji sizes */
  size?: "xs" | "sm" | "md" | "lg";
  /** Additional class names */
  className?: string;
  /** Whether to show tooltip on hover (default: true, requires shortcode) */
  showTooltip?: boolean;
}

/**
 * Text size classes that visually match CustomEmoji image sizes
 * - xs: size-3.5 (14px) → text-sm (14px)
 * - sm: size-4 (16px) → text-base (16px)
 * - md: size-6 (24px) → text-2xl (24px)
 * - lg: size-12 (48px) → text-5xl (48px)
 */
const sizeClasses = {
  xs: "text-sm",
  sm: "text-base",
  md: "text-2xl",
  lg: "text-5xl",
};

/**
 * Renders a unicode emoji with consistent sizing
 * Size variants match CustomEmoji for visual consistency
 */
export function UnicodeEmoji({
  emoji,
  shortcode,
  size = "md",
  className,
  showTooltip = true,
}: UnicodeEmojiProps) {
  const emojiSpan = (
    <span
      className={cn("inline-block leading-none", sizeClasses[size], className)}
      role="img"
      aria-label={shortcode ? `:${shortcode}:` : emoji}
    >
      {emoji}
    </span>
  );

  // Only show tooltip if shortcode is provided and showTooltip is true
  if (!showTooltip || !shortcode) {
    return emojiSpan;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{emojiSpan}</TooltipTrigger>
      <TooltipContent>:{shortcode}:</TooltipContent>
    </Tooltip>
  );
}
