/**
 * Compact media renderer for RichText
 *
 * Shows compact inline file info with expandable media:
 * [icon] truncated-hash [blossom]
 *
 * Click on filename expands to show the actual media inline (not collapsible).
 * Tooltip shows imeta info when available.
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
import { MediaEmbed } from "@/components/nostr/MediaEmbed";
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
 * Format duration in seconds to human readable format
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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

export function CompactMediaRenderer({ url, type, imeta }: MediaRendererProps) {
  const { addWindow } = useGrimoire();
  const [expanded, setExpanded] = useState(false);

  const truncatedHash = getTruncatedHash(url);
  const blossom = parseBlossomUrl(url);

  const handleBlossomClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (blossom) {
      // Build command string for Edit functionality - include media type
      const commandString = `blossom blob ${blossom.sha256} ${blossom.serverUrl} --type ${type}`;
      addWindow(
        "blossom",
        {
          subcommand: "blob",
          sha256: blossom.sha256,
          serverUrl: blossom.serverUrl,
          blobUrl: url, // Pass full URL with extension
          mediaType: type, // Pass media type for preview
        },
        commandString,
      );
    }
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded(true);
  };

  // When expanded, show plain MediaEmbed (not collapsible)
  if (expanded) {
    return (
      <span className="block max-w-sm my-1">
        <MediaEmbed
          url={url}
          type={type}
          alt={imeta?.alt}
          preset="inline"
          enableZoom={type === "image"}
        />
      </span>
    );
  }

  // Build tooltip content from imeta if available
  // Format: "Field <value>" with field name and value side by side
  const tooltipContent = imeta ? (
    <div className="space-y-1 text-xs">
      {imeta.x && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Hash</span>
          <span className="font-mono truncate max-w-48">{imeta.x}</span>
        </div>
      )}
      {imeta.size && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Size</span>
          <span>{formatFileSize(imeta.size)}</span>
        </div>
      )}
      {imeta.dim && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Dimensions</span>
          <span>{imeta.dim}</span>
        </div>
      )}
      {imeta.m && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Type</span>
          <span>{imeta.m}</span>
        </div>
      )}
      {imeta.duration && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Duration</span>
          <span>{formatDuration(imeta.duration)}</span>
        </div>
      )}
      {imeta.alt && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Alt</span>
          <span className="truncate max-w-48">{imeta.alt}</span>
        </div>
      )}
    </div>
  ) : null;

  const compactView = (
    <span className="inline-flex items-center gap-1 border-b border-dotted border-muted-foreground/50">
      <MediaIcon type={type} />
      <button
        onClick={handleExpand}
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
  );

  // Only wrap in tooltip if we have imeta
  if (tooltipContent) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{compactView}</TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    );
  }

  return compactView;
}
