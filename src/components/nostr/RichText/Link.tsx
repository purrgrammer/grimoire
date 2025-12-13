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

interface LinkNodeProps {
  node: {
    href: string;
  };
}

export function Link({ node }: LinkNodeProps) {
  const options = useRichTextOptions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { href } = node;

  const handleAudioClick = () => {
    setDialogOpen(true);
  };

  // Check if media should be shown
  const shouldShowMedia = options.showMedia;

  // Render appropriate link type
  if (isImageURL(href)) {
    if (shouldShowMedia && options.showImages) {
      return (
        <MediaEmbed
          url={href}
          type="image"
          preset="inline"
          enableZoom
          className="inline-block"
        />
      );
    }
    return <PlainLink url={href} />;
  }

  if (isVideoURL(href)) {
    if (shouldShowMedia && options.showVideos) {
      return (
        <MediaEmbed
          url={href}
          type="video"
          preset="inline"
          className="inline-block"
        />
      );
    }
    return <PlainLink url={href} />;
  }

  if (isAudioURL(href)) {
    if (shouldShowMedia && options.showAudio) {
      return (
        <>
          <MediaEmbed
            url={href}
            type="audio"
            onAudioClick={handleAudioClick}
            className="inline-block"
          />
          <MediaDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            urls={[href]}
            initialIndex={0}
          />
        </>
      );
    }
    return <PlainLink url={href} />;
  }

  // Plain link for non-media URLs
  return <PlainLink url={href} />;
}
