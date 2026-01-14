import type { RichTextOptions } from "@/components/nostr/RichText";

/**
 * Media rendering presets for different contexts
 *
 * These presets provide optimized configurations for common use cases,
 * balancing visual quality, performance, and user experience.
 */

/**
 * Chat message preset - Balanced for conversation flow
 * - Adaptive grid columns based on media count
 * - Normal size with preserved aspect ratios
 * - Full interactivity (zoom, transitions)
 */
export const CHAT_PRESET: RichTextOptions = {
  showMedia: true,
  showImages: true,
  showVideos: true,
  showAudio: true,
  showEventEmbeds: true,
  mediaSize: "normal",
  galleryColumns: "auto", // Adaptive: 1 col for single, 2 for pair, 3 for multiple
  preserveAspectRatio: true,
  enableTransitions: true,
  roundedCorners: "md",
  enableZoom: true,
};

/**
 * Reply preview preset - Minimal for context
 * - No media shown (or use compact with showMedia: true)
 * - Keeps replies lightweight and focused on text
 */
export const REPLY_PRESET: RichTextOptions = {
  showMedia: false,
  showEventEmbeds: false,
  mediaSize: "compact",
  galleryColumns: 1,
  preserveAspectRatio: true,
  enableTransitions: false,
  roundedCorners: "sm",
  enableZoom: false,
};

/**
 * Feed item preset - Efficient for scrolling
 * - Compact media size for quick scanning
 * - Fixed 2-column grid for consistency
 * - Reduced animations for smoother scrolling
 */
export const FEED_PRESET: RichTextOptions = {
  showMedia: true,
  showImages: true,
  showVideos: true,
  showAudio: true,
  showEventEmbeds: true,
  mediaSize: "compact",
  galleryColumns: 2,
  preserveAspectRatio: true,
  enableTransitions: false, // Disable for better scroll performance
  roundedCorners: "md",
  enableZoom: true,
};

/**
 * Detail view preset - Full quality for focused viewing
 * - Large media size for detail
 * - 2-column grid for elegant presentation
 * - All features enabled
 */
export const DETAIL_PRESET: RichTextOptions = {
  showMedia: true,
  showImages: true,
  showVideos: true,
  showAudio: true,
  showEventEmbeds: true,
  mediaSize: "large",
  galleryColumns: 2,
  preserveAspectRatio: true,
  enableTransitions: true,
  roundedCorners: "lg",
  enableZoom: true,
};

/**
 * Compact preset - Minimal footprint
 * - Small media with tight spacing
 * - Fixed single column
 * - Reduced visual effects
 */
export const COMPACT_PRESET: RichTextOptions = {
  showMedia: true,
  showImages: true,
  showVideos: true,
  showAudio: true,
  showEventEmbeds: false,
  mediaSize: "compact",
  galleryColumns: 1,
  preserveAspectRatio: true,
  enableTransitions: false,
  roundedCorners: "sm",
  enableZoom: false,
};
