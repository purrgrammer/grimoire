/**
 * Chat-specific media renderer
 *
 * Shows inline file info instead of embedded media:
 * [icon] filename [size] [blossom-link]
 *
 * Click on filename opens media in new tab.
 */

import { Image, Video, Music, File, HardDrive } from "lucide-react";
import { getHashFromURL } from "blossom-client-sdk/helpers/url";
import { useGrimoire } from "@/core/state";
import { formatFileSize } from "@/lib/imeta";
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
  const iconClass = "size-3 shrink-0 text-muted-foreground";
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

  const filename = imeta?.alt || getFilename(url);
  const size = imeta?.size ? formatFileSize(imeta.size) : null;
  const blossom = parseBlossomUrl(url);

  const handleBlossomClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (blossom) {
      // Build command string for Edit functionality
      const commandString = `blossom blob ${blossom.sha256} ${blossom.serverUrl}`;
      addWindow(
        "blossom",
        {
          subcommand: "blob",
          sha256: blossom.sha256,
          serverUrl: blossom.serverUrl,
          blobUrl: url, // Pass full URL with extension
        },
        commandString,
      );
    }
  };

  const handleMediaClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <span className="inline-flex items-center gap-1 border-b border-dotted border-muted-foreground/50">
      <MediaIcon type={type} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleMediaClick}
        className="text-foreground hover:underline truncate max-w-48"
        title={imeta?.alt || url}
      >
        {filename}
      </a>
      {size && (
        <span className="text-muted-foreground text-xs shrink-0">{size}</span>
      )}
      {blossom && (
        <button
          onClick={handleBlossomClick}
          className="text-muted-foreground hover:text-foreground"
          title="View in Blossom"
        >
          <HardDrive className="size-3" />
        </button>
      )}
    </span>
  );
}
