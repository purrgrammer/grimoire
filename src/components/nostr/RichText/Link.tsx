import { useState } from "react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";
import { MediaDialog } from "../MediaDialog";
import { MediaEmbed } from "../MediaEmbed";
import { PlainLink } from "../LinkPreview";
import { CompactMediaRenderer } from "../CompactMediaRenderer";
import { useRichTextOptions, useRichTextEvent } from "../RichText";
import { findImetaForUrl } from "@/lib/imeta";
import { useSettings } from "@/hooks/useSettings";

function MediaPlaceholder({ type }: { type: "image" | "video" | "audio" }) {
  return <span className="text-muted-foreground">[{type}]</span>;
}

interface LinkNodeProps {
  node: {
    href: string;
  };
}

export function Link({ node }: LinkNodeProps) {
  const options = useRichTextOptions();
  const event = useRichTextEvent();
  const { settings } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { href } = node;

  // Check global loadMedia setting
  const loadMedia = settings?.appearance?.loadMedia ?? true;

  // Look up imeta for this URL if event is available
  const imeta = event ? findImetaForUrl(event, href) : undefined;

  const handleAudioClick = () => {
    setDialogOpen(true);
  };

  // Check if media should be shown
  const shouldShowMedia = options.showMedia;

  // Render appropriate link type
  if (isImageURL(href)) {
    if (shouldShowMedia && options.showImages) {
      if (!loadMedia) {
        return <CompactMediaRenderer url={href} type="image" imeta={imeta} />;
      }
      return (
        <MediaEmbed
          url={href}
          type="image"
          preset="inline"
          enableZoom
          className="my-2 inline-block"
        />
      );
    }
    return <MediaPlaceholder type="image" />;
  }

  if (isVideoURL(href)) {
    if (shouldShowMedia && options.showVideos) {
      if (!loadMedia) {
        return <CompactMediaRenderer url={href} type="video" imeta={imeta} />;
      }
      return (
        <MediaEmbed
          url={href}
          type="video"
          preset="inline"
          className="my-2 inline-block"
        />
      );
    }
    return <MediaPlaceholder type="video" />;
  }

  if (isAudioURL(href)) {
    if (shouldShowMedia && options.showAudio) {
      if (!loadMedia) {
        return <CompactMediaRenderer url={href} type="audio" imeta={imeta} />;
      }
      return (
        <>
          <MediaEmbed
            url={href}
            type="audio"
            onAudioClick={handleAudioClick}
            className="my-2 inline-block"
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
    return <MediaPlaceholder type="audio" />;
  }

  // Plain link for non-media URLs
  return <PlainLink url={href} />;
}
