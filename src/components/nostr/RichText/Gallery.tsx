import { useState } from "react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";
import { MediaDialog } from "../MediaDialog";
import { MediaEmbed } from "../MediaEmbed";
import { CompactMediaRenderer } from "../CompactMediaRenderer";
import { useDecryptedMedia } from "@/hooks/useDecryptedMedia";
import type { ImetaEntry } from "@/lib/imeta";
import { useRichTextOptions, useRichTextEvent } from "../RichText";
import { findImetaForUrl } from "@/lib/imeta";
import { useSettings } from "@/hooks/useSettings";

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

/**
 * One gallery item.
 *
 * Its own component so the decryption hook can run per item — an encrypted
 * attachment's URL serves ciphertext, and a plain function inside `Gallery`
 * cannot call a hook.
 */
function GalleryMedia({
  url,
  imeta,
  showMedia,
  showImages,
  showVideos,
  showAudio,
  loadMedia,
  onAudioClick,
}: {
  url: string;
  imeta: ImetaEntry | undefined;
  showMedia: boolean;
  showImages: boolean;
  showVideos: boolean;
  showAudio: boolean;
  loadMedia: boolean;
  onAudioClick: () => void;
}) {
  const media = useDecryptedMedia(url, imeta);

  // Never fall back to the ciphertext URL — rendering whatever the host served
  // is what the plaintext hash exists to prevent.
  if (media.failed) {
    return (
      <span className="block text-xs text-muted-foreground">
        Could not decrypt this attachment.
      </span>
    );
  }
  const src = media.url;

  if (isImageURL(url)) {
    if (showMedia && showImages) {
      if (!src) return <MediaPlaceholder type="image" />;
      if (!loadMedia) {
        return (
          <CompactMediaRenderer
            url={url}
            src={src}
            type="image"
            imeta={imeta}
          />
        );
      }
      return <MediaEmbed url={src} type="image" preset="grid" enableZoom />;
    }
    return <MediaPlaceholder type="image" />;
  }
  if (isVideoURL(url)) {
    if (showMedia && showVideos) {
      if (!src) return <MediaPlaceholder type="video" />;
      if (!loadMedia) {
        return (
          <CompactMediaRenderer
            url={url}
            src={src}
            type="video"
            imeta={imeta}
          />
        );
      }
      return <MediaEmbed url={src} type="video" preset="grid" />;
    }
    return <MediaPlaceholder type="video" />;
  }
  if (isAudioURL(url)) {
    if (showMedia && showAudio) {
      if (!src) return <MediaPlaceholder type="audio" />;
      if (!loadMedia) {
        return (
          <CompactMediaRenderer
            url={url}
            src={src}
            type="audio"
            imeta={imeta}
          />
        );
      }
      return <MediaEmbed url={src} type="audio" onAudioClick={onAudioClick} />;
    }
    return <MediaPlaceholder type="audio" />;
  }
  // Non-media URLs shouldn't appear in galleries, but handle gracefully
  return null;
}

export function Gallery({ node }: GalleryNodeProps) {
  const options = useRichTextOptions();
  const event = useRichTextEvent();
  const { settings } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);

  // Check global loadMedia setting
  const loadMedia = settings?.appearance?.loadMedia ?? true;

  const links = node.links || [];

  const handleAudioClick = (index: number) => {
    setInitialIndex(index);
    setDialogOpen(true);
  };

  const renderLink = (url: string, index: number) => (
    <GalleryMedia
      url={url}
      imeta={event ? findImetaForUrl(event, url) : undefined}
      showMedia={options.showMedia}
      showImages={options.showImages}
      showVideos={options.showVideos}
      showAudio={options.showAudio}
      loadMedia={loadMedia}
      onAudioClick={() => handleAudioClick(index)}
    />
  );

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
