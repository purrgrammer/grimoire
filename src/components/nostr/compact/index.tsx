import type { NostrEvent } from "@/types/nostr";
import { getEventDisplayTitle } from "@/lib/event-title";
import { getTagValue } from "applesauce-core/helpers";
import { RichText } from "../RichText";

// Compact preview renderer type - receives event, returns content for preview area
export type CompactPreviewRenderer = React.ComponentType<{ event: NostrEvent }>;

/**
 * Extract a short content preview from an event
 * Used for showing what was reposted/reacted/zapped
 */
export function getContentPreview(event: NostrEvent, maxLength = 50): string {
  // Handle voice messages specially - content is just a URL
  if (event.kind === 1222 || event.kind === 1244) {
    return "Voice message";
  }

  // Try to get title first (for articles, etc.)
  const title = getTagValue(event, "title") || getTagValue(event, "subject");
  if (title) {
    return title.length > maxLength ? title.slice(0, maxLength) + "..." : title;
  }

  // Fall back to content
  const content = event.content || "";
  if (!content) {
    return getEventDisplayTitle(event, true);
  }

  // Clean up content (remove markdown, links, etc.)
  const cleaned = content
    .replace(/https?:\/\/\S+/g, "") // Remove URLs
    .replace(/nostr:[a-z0-9]+/gi, "") // Remove nostr: references
    .replace(/\n+/g, " ") // Replace newlines with spaces
    .trim();

  if (!cleaned) {
    return getEventDisplayTitle(event, true);
  }

  return cleaned.length > maxLength
    ? cleaned.slice(0, maxLength) + "..."
    : cleaned;
}

// Registry for kind-specific compact renderers
// Keys are kind numbers, values are components that render the preview content
export const compactRenderers: Partial<Record<number, CompactPreviewRenderer>> =
  {};

/**
 * Register a compact preview renderer for a specific kind
 * @param kind - The event kind number
 * @param renderer - The component to render the preview
 */
export function registerCompactRenderer(
  kind: number,
  renderer: CompactPreviewRenderer,
) {
  compactRenderers[kind] = renderer;
}

/**
 * Default compact preview for events without a specific renderer
 * Shows event title/content preview with RichText
 */
export function DefaultCompactPreview({ event }: { event: NostrEvent }) {
  // Try to get a title, fall back to content preview
  const title = getEventDisplayTitle(event, false);

  // If event has a specific title (not the content itself), show it as plain text
  // Otherwise, render the full event content with RichText for custom emoji support
  const hasSpecificTitle = title !== event.content;

  return (
    <span className="truncate line-clamp-1 text-muted-foreground text-sm">
      {hasSpecificTitle ? (
        <RichText
          content={title}
          className="inline text-sm leading-none"
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      ) : (
        <RichText
          event={event}
          className="inline text-sm leading-none"
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      )}
    </span>
  );
}

// Import and register compact renderers
import { RepostCompactPreview } from "./RepostCompactPreview";
import { ReactionCompactPreview } from "./ReactionCompactPreview";
import { GenericRepostCompactPreview } from "./GenericRepostCompactPreview";
import { ZapCompactPreview } from "./ZapCompactPreview";
import { VoiceMessageCompactPreview } from "./VoiceMessageCompactPreview";

registerCompactRenderer(6, RepostCompactPreview);
registerCompactRenderer(7, ReactionCompactPreview);
registerCompactRenderer(16, GenericRepostCompactPreview);
registerCompactRenderer(9735, ZapCompactPreview);
registerCompactRenderer(1222, VoiceMessageCompactPreview);
registerCompactRenderer(1244, VoiceMessageCompactPreview);
