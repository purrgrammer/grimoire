import { useState } from "react";
import { cn } from "@/lib/utils";

export interface CustomEmojiProps {
  /** The shortcode (without colons) */
  shortcode: string;
  /** The image URL */
  url: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional class names */
  className?: string;
}

const sizeClasses = {
  sm: "size-4",
  md: "size-6",
  lg: "size-12",
};

/**
 * Renders a custom emoji image from NIP-30
 * Handles loading states and errors gracefully
 */
export function CustomEmoji({
  shortcode,
  url,
  size = "md",
  className,
}: CustomEmojiProps) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center bg-muted rounded text-muted-foreground text-xs",
          sizeClasses[size],
          className,
        )}
        title={`:${shortcode}:`}
      >
        ?
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={`:${shortcode}:`}
      title={`:${shortcode}:`}
      className={cn(
        "inline-block object-contain",
        sizeClasses[size],
        className,
      )}
      loading="lazy"
      onError={() => setError(true)}
    />
  );
}
