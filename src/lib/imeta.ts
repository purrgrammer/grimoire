/**
 * Utilities for parsing imeta tags (NIP-92) and file metadata tags (NIP-94)
 */

import type { NostrEvent } from "@/types/nostr";

export interface ImetaEntry {
  url: string;
  m?: string; // MIME type
  blurhash?: string;
  dim?: string; // dimensions (e.g., "1920x1080")
  alt?: string; // alt text
  x?: string; // SHA-256 hash
  size?: string; // file size in bytes
  fallback?: string[]; // fallback URLs
}

/**
 * Parse an imeta tag into structured data
 * Format: ["imeta", "url https://...", "m image/jpeg", "blurhash U...]
 */
export function parseImetaTag(tag: string[]): ImetaEntry | null {
  if (tag[0] !== "imeta" || tag.length < 2) return null;

  const entry: Partial<ImetaEntry> = {};

  // Parse each key-value pair
  for (let i = 1; i < tag.length; i++) {
    const parts = tag[i].split(" ");
    if (parts.length < 2) continue;

    const key = parts[0];
    const value = parts.slice(1).join(" ");

    if (key === "url") {
      entry.url = value;
    } else if (key === "fallback") {
      if (!entry.fallback) entry.fallback = [];
      entry.fallback.push(value);
    } else {
      (entry as any)[key] = value;
    }
  }

  // URL is required
  if (!entry.url) return null;

  return entry as ImetaEntry;
}

/**
 * Parse all imeta tags from an event
 */
export function parseImetaTags(event: NostrEvent): ImetaEntry[] {
  return event.tags
    .filter((tag) => tag[0] === "imeta")
    .map(parseImetaTag)
    .filter((entry): entry is ImetaEntry => entry !== null);
}

/**
 * Parse file metadata from NIP-94 kind 1063 event tags
 */
export function parseFileMetadata(event: NostrEvent): ImetaEntry {
  const metadata: Partial<ImetaEntry> = {};

  for (const tag of event.tags) {
    const [key, value] = tag;
    if (!value) continue;

    switch (key) {
      case "url":
        metadata.url = value;
        break;
      case "m":
        metadata.m = value;
        break;
      case "x":
        metadata.x = value;
        break;
      case "size":
        metadata.size = value;
        break;
      case "dim":
        metadata.dim = value;
        break;
      case "blurhash":
        metadata.blurhash = value;
        break;
      case "alt":
        metadata.alt = value;
        break;
    }
  }

  return metadata as ImetaEntry;
}

/**
 * Get the primary image URL from a picture event (kind 20)
 * Tries imeta tags first, then falls back to content
 */
export function getPictureUrl(event: NostrEvent): string | null {
  // Try imeta tags first
  const imeta = parseImetaTags(event);
  if (imeta.length > 0 && imeta[0].url) {
    return imeta[0].url;
  }

  // Fallback: try to extract URL from content
  const urlMatch = event.content.match(/https?:\/\/[^\s]+/);
  return urlMatch ? urlMatch[0] : null;
}

/**
 * Check if a MIME type is an image
 */
export function isImageMime(mime?: string): boolean {
  if (!mime) return false;
  return mime.startsWith("image/");
}

/**
 * Check if a MIME type is a video
 */
export function isVideoMime(mime?: string): boolean {
  if (!mime) return false;
  return mime.startsWith("video/");
}

/**
 * Check if a MIME type is audio
 */
export function isAudioMime(mime?: string): boolean {
  if (!mime) return false;
  return mime.startsWith("audio/");
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes?: string | number): string {
  if (!bytes) return "Unknown size";

  const size = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (isNaN(size)) return "Unknown size";

  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let displaySize = size;

  while (displaySize >= 1024 && unitIndex < units.length - 1) {
    displaySize /= 1024;
    unitIndex++;
  }

  return `${displaySize.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Extract aspect ratio from imeta dimensions string
 * @param dim - dimensions string like "1920x1080"
 * @returns aspect ratio as string like "16/9" or undefined if invalid
 */
export function getAspectRatioFromDimensions(
  dim?: string,
): string | undefined {
  if (!dim) return undefined;

  const match = dim.match(/^(\d+)x(\d+)$/);
  if (!match) return undefined;

  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);

  if (width <= 0 || height <= 0) return undefined;

  // Return as CSS aspect-ratio value
  return `${width}/${height}`;
}
