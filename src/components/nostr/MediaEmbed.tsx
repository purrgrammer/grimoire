import { useState } from "react";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import { Music, AlertCircle } from "lucide-react";
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
  preset?: "inline" | "thumbnail" | "preview" | "banner";
  className?: string;

  // Image-specific
  enableZoom?: boolean; // default: true for images

  // Video/Audio-specific
  showControls?: boolean; // default: true
  onAudioClick?: () => void; // open dialog for audio
}

const PRESETS = {
  inline: {
    maxHeight: "300px",
    maxWidth: "100%",
    rounded: "rounded-lg",
  },
  thumbnail: {
    maxWidth: "120px",
    maxHeight: "120px",
    rounded: "rounded-md",
  },
  preview: {
    maxHeight: "500px",
    maxWidth: "100%",
    rounded: "rounded-lg",
  },
  banner: {
    maxHeight: "200px",
    maxWidth: "100%",
    rounded: "rounded-xl",
  },
} as const;

/**
 * MediaEmbed component for displaying images, videos, and audio with constraints
 * - Images: Use react-medium-image-zoom for inline zoom
 * - Videos: Show preview with play button, can trigger dialog
 * - Audio: Show audio player
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
}: MediaEmbedProps) {
  const [error, setError] = useState(false);

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

  const handleError = () => {
    setError(true);
  };

  // Error fallback UI
  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 p-4 border border-destructive/50 rounded-lg bg-destructive/10",
          className,
        )}
      >
        <AlertCircle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-destructive">Failed to load media</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline hover:text-primary/80"
        >
          Open in new tab
        </a>
      </div>
    );
  }

  // Image rendering with zoom
  if (mediaType === "image") {
    const imageElement = (
      <img
        src={url}
        alt={alt || "Image"}
        loading="lazy"
        className={cn(
          "w-full h-auto object-contain",
          presetStyles.rounded,
          enableZoom && "cursor-zoom-in",
          className,
        )}
        style={{
          maxHeight: presetStyles.maxHeight,
          maxWidth: preset === "thumbnail" ? presetStyles.maxWidth : "100%",
        }}
        onError={handleError}
      />
    );

    return enableZoom ? (
      <Zoom zoomMargin={40}>{imageElement}</Zoom>
    ) : (
      imageElement
    );
  }

  // Video rendering with inline playback
  if (mediaType === "video") {
    return (
      <video
        src={url}
        className={cn("w-full", presetStyles.rounded, className)}
        style={{ maxHeight: presetStyles.maxHeight }}
        preload="metadata"
        controls={showControls}
        onError={handleError}
      />
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
          "flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/20",
          onAudioClick &&
            "cursor-crosshair hover:bg-muted/30 transition-colors",
          className,
        )}
        onClick={onAudioClick ? handleAudioClick : undefined}
      >
        <Music className="w-4 h-4 text-muted-foreground flex-shrink-0" />
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
