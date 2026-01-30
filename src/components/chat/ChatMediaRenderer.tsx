/**
 * Chat-specific media renderer
 *
 * Shows inline file info instead of embedded media:
 * [icon] filename [size] [blossom-link]
 */

import { useState } from "react";
import { Image, Video, Music, File, Flower2 } from "lucide-react";
import { getHashFromURL } from "blossom-client-sdk/helpers/url";
import { useGrimoire } from "@/core/state";
import { formatFileSize } from "@/lib/imeta";
import { MediaDialog } from "@/components/nostr/MediaDialog";
import type { MediaRendererProps } from "@/components/nostr/RichText";

/**
 * Extract file extension from URL
 */
function getExtension(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastSegment = pathname.split("/").pop() || "";
    if (lastSegment.includes(".")) {
      return lastSegment.split(".").pop() || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract filename from URL
 */
function getFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastSegment = pathname.split("/").pop() || "";
    // If it's a blossom hash, truncate it
    const hash = getHashFromURL(url);
    if (hash) {
      const ext = getExtension(url);
      return ext ? `${hash.slice(0, 8)}...${ext}` : `${hash.slice(0, 8)}...`;
    }
    // Decode URI component for readable filenames
    return decodeURIComponent(lastSegment) || "file";
  } catch {
    return "file";
  }
}

/**
 * Parse blossom URL - returns sha256 and server URL if valid
 */
function parseBlossomUrl(
  url: string,
): { sha256: string; serverUrl: string } | null {
  const sha256 = getHashFromURL(url);
  if (!sha256) return null;

  try {
    const urlObj = new URL(url);
    const serverUrl = `${urlObj.protocol}//${urlObj.host}`;
    return { sha256, serverUrl };
  } catch {
    return null;
  }
}

/**
 * Get icon component based on media type
 */
function MediaIcon({ type }: { type: "image" | "video" | "audio" }) {
  const iconClass = "size-3.5 shrink-0 text-muted-foreground";
  switch (type) {
    case "image":
      return <Image className={iconClass} />;
    case "video":
      return <Video className={iconClass} />;
    case "audio":
      return <Music className={iconClass} />;
    default:
      return <File className={iconClass} />;
  }
}

export function ChatMediaRenderer({ url, type, imeta }: MediaRendererProps) {
  const { addWindow } = useGrimoire();
  const [dialogOpen, setDialogOpen] = useState(false);

  const filename = imeta?.alt || getFilename(url);
  const size = imeta?.size ? formatFileSize(imeta.size) : null;
  const blossom = parseBlossomUrl(url);

  const handleBlossomClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (blossom) {
      addWindow("blossom", {
        subcommand: "blob",
        sha256: blossom.sha256,
        serverUrl: blossom.serverUrl,
      });
    }
  };

  const handleMediaClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Images and videos open in dialog, audio opens in new tab
    if (type === "image" || type === "video") {
      setDialogOpen(true);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      <span className="inline-flex items-center gap-1.5 border border-dotted border-muted-foreground/40 rounded px-1">
        <MediaIcon type={type} />
        <button
          onClick={handleMediaClick}
          className="text-foreground hover:underline truncate max-w-48 text-left"
          title={imeta?.alt || url}
        >
          {filename}
        </button>
        {size && (
          <span className="text-muted-foreground text-xs shrink-0">{size}</span>
        )}
        {blossom && (
          <button
            onClick={handleBlossomClick}
            className="text-muted-foreground hover:text-foreground"
            title="View in Blossom"
          >
            <Flower2 className="size-3" />
          </button>
        )}
      </span>
      <MediaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        urls={[url]}
        initialIndex={0}
      />
    </>
  );
}
