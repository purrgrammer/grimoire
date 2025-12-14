import { Kind0Renderer } from "./Kind0Renderer";
import { Kind1Renderer } from "./Kind1Renderer";
import { Kind3Renderer } from "./Kind3Renderer";
import { RepostRenderer } from "./RepostRenderer";
import { Kind7Renderer } from "./Kind7Renderer";
import { Kind9Renderer } from "./Kind9Renderer";
import { Kind20Renderer } from "./Kind20Renderer";
import { Kind21Renderer } from "./Kind21Renderer";
import { Kind22Renderer } from "./Kind22Renderer";
import { Kind1063Renderer } from "./Kind1063Renderer";
import { Kind1621Renderer } from "./Kind1621Renderer";
import { Kind9735Renderer } from "./Kind9735Renderer";
import { Kind9802Renderer } from "./Kind9802Renderer";
import { Kind10002Renderer } from "./Kind10002Renderer";
import { Kind30023Renderer } from "./Kind30023Renderer";
import { Kind30617Renderer } from "./Kind30617Renderer";
import { Kind39701Renderer } from "./Kind39701Renderer";
import { GenericRelayListRenderer } from "./GenericRelayListRenderer";
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
  6: RepostRenderer, // Repost
  7: Kind7Renderer, // Reaction
  9: Kind9Renderer, // Chat Message (NIP-C7)
  16: RepostRenderer, // Generic Repost
  20: Kind20Renderer, // Picture (NIP-68)
  21: Kind21Renderer, // Video Event (NIP-71)
  22: Kind22Renderer, // Short Video (NIP-71)
  1063: Kind1063Renderer, // File Metadata (NIP-94)
  1111: Kind1Renderer, // Post
  1621: Kind1621Renderer, // Issue (NIP-34)
  9735: Kind9735Renderer, // Zap Receipt
  9802: Kind9802Renderer, // Highlight
  10002: Kind10002Renderer, // Relay List Metadata (NIP-65)
  10006: GenericRelayListRenderer, // Blocked Relays (NIP-51)
  10007: GenericRelayListRenderer, // Search Relays (NIP-51)
  10012: GenericRelayListRenderer, // Favorite Relays (NIP-51)
  10050: GenericRelayListRenderer, // DM Relay List (NIP-51)
  30002: GenericRelayListRenderer, // Relay Sets (NIP-51)
  30023: Kind30023Renderer, // Long-form Article
  30617: Kind30617Renderer, // Repository (NIP-34)
  39701: Kind39701Renderer, // Web Bookmarks (NIP-B0)
};

/**
 * Default renderer for kinds without custom implementations
 * Shows basic event info with raw content
 */
function DefaultKindRenderer({ event }: BaseEventProps) {
  return (
    <BaseEventContainer event={event}>
      <div className="text-sm text-muted-foreground">
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
  depth = 0,
}: {
  event: NostrEvent;
  depth?: number;
}) {
  const Renderer = kindRenderers[event.kind] || DefaultKindRenderer;
  return <Renderer event={event} depth={depth} />;
}

/**
 * Export kind renderers registry for dynamic kind detection
 */
export { kindRenderers };

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
export {
  RepostRenderer,
  Kind6Renderer,
  Kind16Renderer,
} from "./RepostRenderer";
export { Kind7Renderer } from "./Kind7Renderer";
export { Kind9Renderer } from "./Kind9Renderer";
export { Kind20Renderer } from "./Kind20Renderer";
export { Kind21Renderer } from "./Kind21Renderer";
export { Kind22Renderer } from "./Kind22Renderer";
export { Kind1063Renderer } from "./Kind1063Renderer";
export { Kind9735Renderer } from "./Kind9735Renderer";
