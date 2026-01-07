import { useState, useEffect } from "react";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import { Mic, AlertCircle, Play, RotateCw } from "lucide-react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";
import { cn } from "@/lib/utils";

interface MediaEmbedProps {
  url: string;
  type?: "image" | "video" | "audio" | "auto";
  alt?: string;
  preset?: "inline" | "thumbnail" | "grid" | "preview" | "banner";
  className?: string;

  // Image-specific
  enableZoom?: boolean; // default: true for images

  // Video/Audio-specific
  showControls?: boolean; // default: true
  onAudioClick?: () => void; // open dialog for audio

  // Loading & Performance
  aspectRatio?: string; // "16/9", "4/3", "1/1", "auto" - defaults based on media type
  showPlaceholder?: boolean; // default: true
  fadeIn?: boolean; // default: true
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

const PRESETS = {
  inline: {
    maxHeightClass: "max-h-[300px]",
    maxWidthClass: "max-w-full",
    roundedClass: "rounded-lg",
  },
  thumbnail: {
    maxHeightClass: "max-h-[120px]",
    maxWidthClass: "max-w-[120px]",
    roundedClass: "rounded-md",
  },
  grid: {
    maxHeightClass: "",
    maxWidthClass: "w-full",
    roundedClass: "rounded-md",
    objectFit: "cover" as const,
  },
  preview: {
    maxHeightClass: "max-h-[500px]",
    maxWidthClass: "max-w-full",
    roundedClass: "rounded-lg",
  },
  banner: {
    maxHeightClass: "max-h-[200px]",
    maxWidthClass: "max-w-full",
    roundedClass: "rounded-xl",
  },
} as const;

/**
 * Get default aspect ratio based on media type and preset
 */
const getDefaultAspectRatio = (
  mediaType: string,
  preset: string,
): string | undefined => {
  if (preset === "thumbnail" || preset === "grid") return "1/1";
  if (mediaType === "video") return "16/9";
  return undefined; // auto for images
};

/**
 * Convert aspect ratio string to Tailwind class
 */
const getAspectRatioClass = (
  aspectRatio: string | undefined,
): string | undefined => {
  if (!aspectRatio || aspectRatio === "auto") return undefined;

  // Map common ratios to Tailwind utilities
  switch (aspectRatio) {
    case "16/9":
      return "aspect-video";
    case "1/1":
      return "aspect-square";
    case "4/3":
      return "aspect-[4/3]";
    case "3/2":
      return "aspect-[3/2]";
    default:
      // For custom ratios, use arbitrary value syntax
      return `aspect-[${aspectRatio}]`;
  }
};

/**
 * Skeleton placeholder component with shimmer effect
 */
const SkeletonPlaceholder = ({
  rounded,
  children,
}: {
  rounded: string;
  children?: React.ReactNode;
}) => (
  <div
    className={cn(
      "absolute inset-0 bg-muted/20 animate-pulse flex items-center justify-center",
      rounded,
    )}
    aria-busy="true"
    aria-label="Loading media"
  >
    {children}
  </div>
);

/**
 * MediaEmbed component for displaying images, videos, and audio with constraints
 * - Images: Use react-medium-image-zoom for inline zoom
 * - Videos: Show preview with play button, can trigger dialog
 * - Audio: Show audio player
 *
 * Features:
 * - Loading placeholders with skeleton shimmer
 * - Aspect ratio preservation to prevent layout shift
 * - Smooth fade-in animations
 * - Error handling with retry mechanism
 * - Performance optimized with Tailwind classes
 */
export function MediaEmbed({
  url,
  type = "auto",
  alt,
  preset = "inline",
  className = "",
  enableZoom = true,
  showControls = true,
  onAudioClick,
  aspectRatio,
  showPlaceholder = true,
  fadeIn = true,
  onLoad,
  onError: onErrorCallback,
}: MediaEmbedProps) {
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Auto-detect media type if not specified
  const mediaType =
    type === "auto"
      ? isImageURL(url)
        ? "image"
        : isVideoURL(url)
          ? "video"
          : isAudioURL(url)
            ? "audio"
            : "unknown"
      : type;

  const presetStyles = PRESETS[preset];

  // Determine aspect ratio (user override or default based on type/preset)
  const effectiveAspectRatio =
    aspectRatio || getDefaultAspectRatio(mediaType, preset);

  const aspectClass = getAspectRatioClass(effectiveAspectRatio);

  // Reset states when URL changes
  useEffect(() => {
    setIsLoading(true);
    setIsLoaded(false);
    setError(false);
  }, [url]);

  const handleError = () => {
    setIsLoading(false);
    setError(true);
    if (onErrorCallback) {
      const error = new Error("Failed to load media");
      onErrorCallback(error);
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
    setIsLoaded(true);
    if (onLoad) onLoad();
  };

  const handleRetry = () => {
    setError(false);
    setIsLoading(true);
    setRetryCount((prev) => prev + 1);
  };

  // Error fallback UI with retry
  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-3 p-4 border border-destructive/50 rounded-lg bg-destructive/10",
          className,
        )}
        role="alert"
        aria-live="polite"
      >
        <AlertCircle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-destructive font-medium">
          Failed to load media
        </p>
        <div className="flex gap-2">
          {mediaType === "image" && (
            <button
              onClick={handleRetry}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              aria-label="Retry loading media"
            >
              <RotateCw className="w-3 h-3" />
              Retry
            </button>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-xs text-primary underline hover:text-primary/80"
          >
            Open in new tab
          </a>
        </div>
      </div>
    );
  }

  // Image rendering with zoom, placeholder, and fade-in
  if (mediaType === "image") {
    const imageContent = aspectClass ? (
      // With aspect ratio: use aspect wrapper
      <div
        className={cn(
          "relative overflow-hidden contain-content",
          presetStyles.maxWidthClass,
          presetStyles.roundedClass,
        )}
      >
        <div className={aspectClass}>
          {/* Skeleton placeholder */}
          {showPlaceholder && isLoading && (
            <SkeletonPlaceholder rounded={presetStyles.roundedClass} />
          )}

          {/* Image with fade-in */}
          <img
            key={retryCount} // Force remount on retry
            src={url}
            alt={alt || "Image"}
            loading="lazy"
            className={cn(
              "w-full h-full",
              preset === "grid" ? "object-cover" : "object-contain",
              presetStyles.roundedClass,
              enableZoom && "cursor-zoom-in",
              fadeIn && "transition-opacity duration-300",
              isLoaded ? "opacity-100" : "opacity-0",
              className,
            )}
            onLoad={handleLoad}
            onError={handleError}
            aria-label={alt || "Image"}
          />
        </div>
      </div>
    ) : (
      // Without aspect ratio: direct image with size constraints
      <div
        className={cn(
          "relative overflow-hidden contain-content flex items-center justify-center",
          presetStyles.maxWidthClass,
          presetStyles.maxHeightClass,
          presetStyles.roundedClass,
        )}
      >
        {/* Skeleton placeholder */}
        {showPlaceholder && isLoading && (
          <SkeletonPlaceholder rounded={presetStyles.roundedClass} />
        )}

        {/* Image with fade-in */}
        <img
          key={retryCount} // Force remount on retry
          src={url}
          alt={alt || "Image"}
          loading="lazy"
          className={cn(
            "max-w-full max-h-full object-contain",
            presetStyles.roundedClass,
            enableZoom && "cursor-zoom-in",
            fadeIn && "transition-opacity duration-300",
            isLoaded ? "opacity-100" : "opacity-0",
            className,
          )}
          onLoad={handleLoad}
          onError={handleError}
          aria-label={alt || "Image"}
        />
      </div>
    );

    return enableZoom ? (
      <Zoom zoomMargin={40}>{imageContent}</Zoom>
    ) : (
      imageContent
    );
  }

  // Video rendering with placeholder and loading state
  if (mediaType === "video") {
    return (
      <div
        className={cn(
          "relative overflow-hidden contain-content",
          presetStyles.maxWidthClass,
          presetStyles.roundedClass,
        )}
      >
        <div className={aspectClass || "aspect-video"}>
          {/* Skeleton placeholder with play icon */}
          {showPlaceholder && isLoading && (
            <SkeletonPlaceholder rounded={presetStyles.roundedClass}>
              <Play className="w-12 h-12 text-muted-foreground/50" />
            </SkeletonPlaceholder>
          )}

          {/* Video with fade-in */}
          <video
            key={retryCount} // Force remount on retry
            src={url}
            className={cn(
              "w-full h-full",
              presetStyles.roundedClass,
              fadeIn && "transition-opacity duration-300",
              isLoaded ? "opacity-100" : "opacity-0",
              className,
            )}
            preload="metadata"
            controls={showControls}
            onLoadedMetadata={handleLoad}
            onError={handleError}
            aria-label={alt || "Video"}
          />
        </div>
      </div>
    );
  }

  // Audio rendering
  if (mediaType === "audio") {
    const handleAudioClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onAudioClick) onAudioClick();
    };

    return (
      <div
        className={cn(
          "flex items-center gap-3",
          onAudioClick &&
            "cursor-crosshair hover:opacity-80 transition-opacity",
          className,
        )}
        onClick={onAudioClick ? handleAudioClick : undefined}
      >
        <Mic className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        {!onAudioClick ? (
          <audio
            src={url}
            controls={showControls}
            className="flex-1 h-8"
            controlsList="nodownload"
            onError={handleError}
          />
        ) : (
          <span className="flex-1 text-sm text-muted-foreground truncate">
            {url}
          </span>
        )}
      </div>
    );
  }

  // Unknown media type fallback
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 border border-border rounded-lg bg-muted/20",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">Unsupported media type</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-primary underline hover:text-primary/80 break-all"
      >
        {url}
      </a>
    </div>
  );
}
