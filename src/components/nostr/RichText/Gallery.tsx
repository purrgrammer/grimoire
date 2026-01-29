import { useState } from "react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";
import { MediaDialog } from "../MediaDialog";
import { MediaEmbed } from "../MediaEmbed";
import { useRichTextOptions } from "../RichText";

function MediaPlaceholder({
  type,
}: {
  type: "image" | "video" | "audio" | "gallery";
}) {
  return <span className="text-muted-foreground">[{type}]</span>;
}

interface GalleryNodeProps {
  node: {
    links?: string[];
  };
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

  const renderLink = (url: string, index: number) => {
    // Check if media should be shown
    const shouldShowMedia = options.showMedia;

    if (isImageURL(url)) {
      if (shouldShowMedia && options.showImages) {
        return <MediaEmbed url={url} type="image" preset="grid" enableZoom />;
      }
      return <MediaPlaceholder type="image" />;
    }
    if (isVideoURL(url)) {
      if (shouldShowMedia && options.showVideos) {
        return <MediaEmbed url={url} type="video" preset="grid" />;
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

  // Separate media types for layout
  const imageLinks = links.filter((url) => isImageURL(url));
  const imageVideoLinks = links.filter(
    (url) => isImageURL(url) || isVideoURL(url),
  );
  const audioLinks = links.filter((url) => isAudioURL(url));

  // Check if images/videos/audio should be shown
  const shouldShowImages = options.showMedia && options.showImages;
  const shouldShowAudio = options.showMedia && options.showAudio;

  // Show [gallery] placeholder when images are disabled and gallery contains images
  const showGalleryPlaceholder = imageLinks.length > 0 && !shouldShowImages;

  return (
    <>
      {/* Show single [gallery] placeholder when images are disabled */}
      {showGalleryPlaceholder && <MediaPlaceholder type="gallery" />}

      {/* Grid layout for images/videos when enabled */}
      {imageVideoLinks.length > 0 && !showGalleryPlaceholder && (
        <div className="my-2 grid grid-cols-3 gap-1.5">
          {imageVideoLinks.map((url: string, i: number) => (
            <div key={`${url}-${i}`}>{renderLink(url, links.indexOf(url))}</div>
          ))}
        </div>
      )}
      {/* Stack layout for audio */}
      {audioLinks.length > 0 && (
        <div className="my-2 flex flex-col gap-2">
          {audioLinks.map((url: string, i: number) => (
            <div key={`${url}-${i}`}>{renderLink(url, links.indexOf(url))}</div>
          ))}
        </div>
      )}
      {audioLinks.length > 0 && shouldShowAudio && (
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
