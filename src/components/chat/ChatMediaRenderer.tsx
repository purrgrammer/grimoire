/**
 * Chat-specific media renderer
 *
 * Shows inline file info instead of embedded media:
 * [icon] filename [size] [blossom-link]
 */

import { Image, Video, Music, File, Flower2 } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { formatFileSize } from "@/lib/imeta";
import type { MediaRendererProps } from "@/components/nostr/RichText";

/**
 * Extract filename from URL
 */
function getFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastSegment = pathname.split("/").pop() || "";
    // If it's a hash (64 hex chars), truncate it
    if (/^[0-9a-f]{64}$/i.test(lastSegment.replace(/\.[^.]+$/, ""))) {
      const ext = lastSegment.includes(".") ? lastSegment.split(".").pop() : "";
      const hash = lastSegment.replace(/\.[^.]+$/, "");
      return ext ? `${hash.slice(0, 8)}...${ext}` : `${hash.slice(0, 8)}...`;
    }
    // Decode URI component for readable filenames
    return decodeURIComponent(lastSegment) || "file";
  } catch {
    return "file";
  }
}

/**
 * Check if URL is a blossom URL (has sha256 hash in path)
 * Returns the sha256 and server URL if it is, null otherwise
 */
function parseBlossomUrl(
  url: string,
): { sha256: string; serverUrl: string } | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    // Remove extension if present
    const possibleHash = lastSegment.replace(/\.[^.]+$/, "");

    if (/^[0-9a-f]{64}$/i.test(possibleHash)) {
      const serverUrl = `${urlObj.protocol}//${urlObj.host}`;
      return { sha256: possibleHash.toLowerCase(), serverUrl };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get icon component based on media type
 */
function MediaIcon({ type }: { type: "image" | "video" | "audio" }) {
  const iconClass = "size-4 shrink-0";
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
      addWindow("blossom", {
        subcommand: "blob",
        sha256: blossom.sha256,
        serverUrl: blossom.serverUrl,
      });
    }
  };

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-muted/50 px-2 py-0.5 text-sm">
      <MediaIcon type={type} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleFileClick}
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
          className="text-muted-foreground hover:text-foreground shrink-0"
          title="View in Blossom"
        >
          <Flower2 className="size-3.5" />
        </button>
      )}
    </span>
  );
}
