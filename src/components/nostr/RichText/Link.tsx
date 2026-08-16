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
import { useDecryptedMedia } from "@/hooks/useDecryptedMedia";
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
  /**
   * An encrypted attachment's URL serves CIPHERTEXT, so the decryption has to
   * happen HERE — where the imeta and the href meet — rather than inside one
   * renderer. Doing it in `CompactMediaRenderer` alone missed every reader with
   * media loading ON, which renders `MediaEmbed` directly and never passes
   * through it.
   *
   * For an unencrypted link this is `href` unchanged, so every branch below can
   * use it unconditionally.
   */
  const media = useDecryptedMedia(href, imeta);

  const handleAudioClick = () => {
    setDialogOpen(true);
  };

  // Check if media should be shown
  const shouldShowMedia = options.showMedia;

  // An attachment that would not decrypt, or whose plaintext did not match the
  // hash it was published with, must NOT fall back to the ciphertext URL —
  // rendering whatever the host served is what the hash exists to prevent.
  if (media.failed) {
    return (
      <span className="my-1 block text-xs text-muted-foreground">
        This attachment could not be decrypted, or did not match the hash it was
        published with.
      </span>
    );
  }
  const src = media.url;

  // Render appropriate link type
  if (isImageURL(href)) {
    if (shouldShowMedia && options.showImages) {
      if (!src) return <MediaPlaceholder type="image" />;
      if (!loadMedia) {
        return (
          <CompactMediaRenderer
            url={href}
            src={src}
            type="image"
            imeta={imeta}
          />
        );
      }
      return (
        <MediaEmbed
          url={src}
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
      if (!src) return <MediaPlaceholder type="video" />;
      if (!loadMedia) {
        return (
          <CompactMediaRenderer
            url={href}
            src={src}
            type="video"
            imeta={imeta}
          />
        );
      }
      return (
        <MediaEmbed
          url={src}
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
      if (!src) return <MediaPlaceholder type="audio" />;
      if (!loadMedia) {
        return (
          <CompactMediaRenderer
            url={href}
            src={src}
            type="audio"
            imeta={imeta}
          />
        );
      }
      return (
        <>
          <MediaEmbed
            url={src}
            type="audio"
            onAudioClick={handleAudioClick}
            className="my-2 inline-block"
          />
          <MediaDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            urls={[src]}
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
