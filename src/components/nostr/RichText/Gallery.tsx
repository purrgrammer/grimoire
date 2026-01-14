import { useState } from "react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";
import { MediaDialog } from "../MediaDialog";
import { MediaEmbed } from "../MediaEmbed";
import { useRichTextOptions } from "../RichText";
import { cn } from "@/lib/utils";

function MediaPlaceholder({ type }: { type: "image" | "video" | "audio" }) {
  return <span className="text-muted-foreground">[{type}]</span>;
}

interface GalleryNodeProps {
  node: {
    links?: string[];
  };
}

/**
 * Determine adaptive column count based on media count
 * Logic: 1 image = 1 col, 2 images = 2 cols, 3+ = 3 cols
 */
function getAdaptiveColumns(mediaCount: number): number {
  if (mediaCount === 1) return 1;
  if (mediaCount === 2) return 2;
  return 3;
}

/**
 * Get grid column class based on column count
 */
function getGridColumnsClass(columns: number): string {
  switch (columns) {
    case 1:
      return "grid-cols-1";
    case 2:
      return "grid-cols-2";
    case 3:
      return "grid-cols-3";
    case 4:
      return "grid-cols-4";
    default:
      return "grid-cols-3";
  }
}

/**
 * Get media preset based on mediaSize option
 */
function getMediaPreset(
  mediaSize: "compact" | "normal" | "large",
): "thumbnail" | "grid" | "preview" {
  switch (mediaSize) {
    case "compact":
      return "thumbnail";
    case "large":
      return "preview";
    default:
      return "grid";
  }
}

export function Gallery({ node }: GalleryNodeProps) {
  const options = useRichTextOptions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);

  const links = node.links || [];

  const handleAudioClick = (index: number) => {
    setInitialIndex(index);
    setDialogOpen(true);
  };

  // Determine media preset based on size option
  const mediaPreset = getMediaPreset(options.mediaSize);

  const renderLink = (url: string, index: number) => {
    // Check if media should be shown
    const shouldShowMedia = options.showMedia;

    if (isImageURL(url)) {
      if (shouldShowMedia && options.showImages) {
        return (
          <MediaEmbed
            url={url}
            type="image"
            preset={mediaPreset}
            enableZoom={options.enableZoom}
            fadeIn={options.enableTransitions}
            aspectRatio={options.preserveAspectRatio ? "auto" : "1/1"}
          />
        );
      }
      return <MediaPlaceholder type="image" />;
    }
    if (isVideoURL(url)) {
      if (shouldShowMedia && options.showVideos) {
        return (
          <MediaEmbed
            url={url}
            type="video"
            preset={mediaPreset}
            fadeIn={options.enableTransitions}
            aspectRatio={options.preserveAspectRatio ? "auto" : "16/9"}
          />
        );
      }
      return <MediaPlaceholder type="video" />;
    }
    if (isAudioURL(url)) {
      if (shouldShowMedia && options.showAudio) {
        return (
          <MediaEmbed
            url={url}
            type="audio"
            onAudioClick={() => handleAudioClick(index)}
          />
        );
      }
      return <MediaPlaceholder type="audio" />;
    }
    // Non-media URLs shouldn't appear in galleries, but handle gracefully
    return null;
  };

  // Only show dialog for audio files
  const audioLinks = links.filter((url) => isAudioURL(url));

  // Separate media types for layout
  const imageLinks = links.filter((url) => isImageURL(url) || isVideoURL(url));
  const audioOnlyLinks = links.filter((url) => isAudioURL(url));

  // Determine grid columns (adaptive or fixed)
  const gridColumns =
    options.galleryColumns === "auto"
      ? getAdaptiveColumns(imageLinks.length)
      : options.galleryColumns;
  const gridClass = getGridColumnsClass(gridColumns);

  // Determine gap size based on media size
  const gapClass =
    options.mediaSize === "compact"
      ? "gap-1"
      : options.mediaSize === "large"
        ? "gap-2"
        : "gap-1.5";

  return (
    <>
      {/* Grid layout for images/videos */}
      {imageLinks.length > 0 && (
        <div className={cn("my-2 grid", gridClass, gapClass)}>
          {imageLinks.map((url: string, i: number) => (
            <div key={`${url}-${i}`}>{renderLink(url, links.indexOf(url))}</div>
          ))}
        </div>
      )}
      {/* Stack layout for audio */}
      {audioOnlyLinks.length > 0 && (
        <div className="my-2 flex flex-col gap-2">
          {audioOnlyLinks.map((url: string, i: number) => (
            <div key={`${url}-${i}`}>{renderLink(url, links.indexOf(url))}</div>
          ))}
        </div>
      )}
      {audioLinks.length > 0 && (
        <MediaDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          urls={audioLinks}
          initialIndex={initialIndex}
        />
      )}
    </>
  );
}
