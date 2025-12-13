import { useState } from "react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";
import { MediaDialog } from "../MediaDialog";
import { MediaEmbed } from "../MediaEmbed";
import { PlainLink } from "../LinkPreview";
import { useRichTextOptions } from "../RichText";

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
        return <MediaEmbed url={url} type="image" preset="inline" enableZoom />;
      }
      return <PlainLink url={url} />;
    }
    if (isVideoURL(url)) {
      if (shouldShowMedia && options.showVideos) {
        return <MediaEmbed url={url} type="video" preset="inline" />;
      }
      return <PlainLink url={url} />;
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
      return <PlainLink url={url} />;
    }
    return <PlainLink url={url} />;
  };

  // Only show dialog for audio files
  const audioLinks = links.filter((url) => isAudioURL(url));

  return (
    <>
      <div className="my-2 flex flex-wrap gap-2">
        {links.map((url: string, i: number) => (
          <div key={i}>{renderLink(url, i)}</div>
        ))}
      </div>
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
