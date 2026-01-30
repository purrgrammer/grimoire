/**
 * Chat-specific media renderer
 *
 * Shows compact inline file info with expandable media:
 * [icon] truncated-hash [blossom]
 *
 * Click on filename expands to show the actual media inline.
 * Tooltip shows full filename and size.
 */

import { useState } from "react";
import { Image, Video, Music, File, HardDrive } from "lucide-react";
import { getHashFromURL } from "blossom-client-sdk/helpers/url";
import { useGrimoire } from "@/core/state";
import { formatFileSize } from "@/lib/imeta";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
 * Get display name for the file (for tooltip)
 */
function getFullFilename(url: string, alt?: string): string {
  if (alt) return alt;
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastSegment = pathname.split("/").pop() || "";
    return decodeURIComponent(lastSegment) || "file";
  } catch {
    return "file";
  }
}

/**
 * Get truncated hash display for compact view
 */
function getTruncatedHash(url: string): string {
  const hash = getHashFromURL(url);
  if (hash) {
    const ext = getExtension(url);
    // Show first 6 chars of hash
    return ext ? `${hash.slice(0, 6)}…${ext}` : `${hash.slice(0, 6)}…`;
  }
  // Fallback: truncate filename
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastSegment = decodeURIComponent(pathname.split("/").pop() || "file");
    if (lastSegment.length > 12) {
      const ext = getExtension(url);
      if (ext) {
        const nameWithoutExt = lastSegment.slice(0, -(ext.length + 1));
        return `${nameWithoutExt.slice(0, 6)}…${ext}`;
      }
      return `${lastSegment.slice(0, 8)}…`;
    }
    return lastSegment;
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
  const [expanded, setExpanded] = useState(false);

  const fullFilename = getFullFilename(url, imeta?.alt);
  const truncatedHash = getTruncatedHash(url);
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

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded(!expanded);
  };

  // Build tooltip content
  const tooltipContent = (
    <div className="space-y-0.5">
      <div className="font-medium">{fullFilename}</div>
      {size && <div className="text-muted-foreground">{size}</div>}
    </div>
  );

  if (expanded) {
    return (
      <span className="inline-flex flex-col gap-1">
        {/* Collapsed toggle bar */}
        <span className="inline-flex items-center gap-1 border-b border-dotted border-muted-foreground/50">
          <MediaIcon type={type} />
          <button
            onClick={handleToggleExpand}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            collapse
          </button>
        </span>
        {/* Expanded media */}
        <span className="block max-w-sm">
          {type === "image" && (
            <img
              src={url}
              alt={imeta?.alt || ""}
              className="rounded max-w-full max-h-64 object-contain"
            />
          )}
          {type === "video" && (
            <video src={url} controls className="rounded max-w-full max-h-64" />
          )}
          {type === "audio" && (
            <audio src={url} controls className="w-full max-w-sm" />
          )}
        </span>
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 border-b border-dotted border-muted-foreground/50">
          <MediaIcon type={type} />
          <button
            onClick={handleToggleExpand}
            className="text-foreground hover:underline"
          >
            {truncatedHash}
          </button>
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
      </TooltipTrigger>
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
  );
}
