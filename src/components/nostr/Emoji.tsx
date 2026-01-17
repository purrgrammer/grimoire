import { useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export interface EmojiProps {
  /** Source type - determines how to render */
  source: "unicode" | "custom";
  /** The value - unicode character for unicode, URL for custom */
  value: string;
  /** Shortcode for tooltip (without colons) */
  shortcode: string;
  /** Size variant */
  size?: "xs" | "sm" | "md" | "lg";
  /** Additional class names */
  className?: string;
  /** Whether to show tooltip on hover (default: true) */
  showTooltip?: boolean;
}

/**
 * Size classes for custom emoji images
 */
const imageSizeClasses = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-6",
  lg: "size-12",
};

/**
 * Text size classes for unicode emoji that visually match image sizes
 * - xs: size-3.5 (14px) → text-sm (14px)
 * - sm: size-4 (16px) → text-base (16px)
 * - md: size-6 (24px) → text-2xl (24px)
 * - lg: size-12 (48px) → text-5xl (48px)
 */
const textSizeClasses = {
  xs: "text-sm",
  sm: "text-base",
  md: "text-2xl",
  lg: "text-5xl",
};

/**
 * Unified emoji component that renders both unicode and custom emoji
 * with consistent sizing, tooltips, and error handling.
 *
 * @example
 * // Unicode emoji
 * <Emoji source="unicode" value="👍" shortcode="thumbsup" size="md" />
 *
 * // Custom emoji
 * <Emoji source="custom" value="https://example.com/emoji.png" shortcode="pepe" size="md" />
 *
 * // From EmojiSearchResult
 * <Emoji source={item.source} value={item.url} shortcode={item.shortcode} size="md" />
 */
export function Emoji({
  source,
  value,
  shortcode,
  size = "md",
  className,
  showTooltip = true,
}: EmojiProps) {
  const [error, setError] = useState(false);

  // Render custom emoji with error handling
  if (source === "custom") {
    if (error) {
      return (
        <span
          className={cn(
            "inline-flex items-center justify-center bg-muted rounded text-muted-foreground text-xs",
            imageSizeClasses[size],
            className,
          )}
          title={`:${shortcode}:`}
        >
          ?
        </span>
      );
    }

    const img = (
      <img
        src={value}
        alt={`:${shortcode}:`}
        className={cn(
          "inline-block object-contain",
          imageSizeClasses[size],
          className,
        )}
        loading="lazy"
        onError={() => setError(true)}
      />
    );

    if (!showTooltip) {
      return img;
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>{img}</TooltipTrigger>
        <TooltipContent>:{shortcode}:</TooltipContent>
      </Tooltip>
    );
  }

  // Render unicode emoji
  const emojiSpan = (
    <span
      className={cn(
        "inline-block leading-none",
        textSizeClasses[size],
        className,
      )}
      role="img"
      aria-label={`:${shortcode}:`}
    >
      {value}
    </span>
  );

  if (!showTooltip) {
    return emojiSpan;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{emojiSpan}</TooltipTrigger>
      <TooltipContent>:{shortcode}:</TooltipContent>
    </Tooltip>
  );
}
