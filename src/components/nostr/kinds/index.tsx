import { Kind0Renderer } from "./Kind0Renderer";
import { Kind1Renderer } from "./Kind1Renderer";
import { Kind3Renderer } from "./Kind3Renderer";
import { Kind6Renderer } from "./Kind6Renderer";
import { Kind7Renderer } from "./Kind7Renderer";
import { Kind20Renderer } from "./Kind20Renderer";
import { Kind21Renderer } from "./Kind21Renderer";
import { Kind22Renderer } from "./Kind22Renderer";
import { Kind1063Renderer } from "./Kind1063Renderer";
import { Kind9735Renderer } from "./Kind9735Renderer";
import { Kind9802Renderer } from "./Kind9802Renderer";
import { Kind30023Renderer } from "./Kind30023Renderer";
import { NostrEvent } from "@/types/nostr";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";

/**
 * Registry of kind-specific renderers
 * Add custom renderers here for specific event kinds
 */
const kindRenderers: Record<number, React.ComponentType<BaseEventProps>> = {
  0: Kind0Renderer, // Profile Metadata
  1: Kind1Renderer, // Short Text Note
  3: Kind3Renderer, // Contact List
  6: Kind6Renderer, // Repost
  7: Kind7Renderer, // Reaction
  20: Kind20Renderer, // Picture (NIP-68)
  21: Kind21Renderer, // Video Event (NIP-71)
  22: Kind22Renderer, // Short Video (NIP-71)
  1063: Kind1063Renderer, // File Metadata (NIP-94)
  1111: Kind1Renderer, // Post
  9735: Kind9735Renderer, // Zap Receipt
  9802: Kind9802Renderer, // Highlight
  30023: Kind30023Renderer, // Long-form Article
};

/**
 * Default renderer for kinds without custom implementations
 * Shows basic event info with raw content
 */
function DefaultKindRenderer({ event, showTimestamp }: BaseEventProps) {
  return (
    <BaseEventContainer event={event} showTimestamp={showTimestamp}>
      <div className="text-sm text-muted-foreground">
        <div className="text-xs mb-1">Kind {event.kind} event</div>
        <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words">
          {event.content || "(empty content)"}
        </pre>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Main KindRenderer component
 * Automatically selects the appropriate renderer based on event kind
 */
export function KindRenderer({
  event,
  showTimestamp = false,
}: {
  event: NostrEvent;
  showTimestamp?: boolean;
}) {
  const Renderer = kindRenderers[event.kind] || DefaultKindRenderer;
  return <Renderer event={event} showTimestamp={showTimestamp} />;
}

/**
 * Export individual renderers and base components for reuse
 */
export {
  BaseEventContainer,
  EventAuthor,
  EventMenu,
} from "./BaseEventRenderer";
export type { BaseEventProps } from "./BaseEventRenderer";
export { Kind1Renderer } from "./Kind1Renderer";
export { Kind6Renderer } from "./Kind6Renderer";
export { Kind7Renderer } from "./Kind7Renderer";
export { Kind20Renderer } from "./Kind20Renderer";
export { Kind21Renderer } from "./Kind21Renderer";
export { Kind22Renderer } from "./Kind22Renderer";
export { Kind1063Renderer } from "./Kind1063Renderer";
export { Kind9735Renderer } from "./Kind9735Renderer";
