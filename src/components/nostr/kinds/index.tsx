import { Kind0Renderer } from "./ProfileRenderer";
import { Kind0DetailRenderer } from "./ProfileDetailRenderer";
import { Kind1Renderer } from "./NoteRenderer";
import { Kind1111Renderer } from "./Kind1111Renderer";
import { Kind3Renderer } from "./ContactListRenderer";
import { Kind3DetailView } from "./ContactListRenderer";
import { RepostRenderer } from "./RepostRenderer";
import { Kind7Renderer } from "./ReactionRenderer";
import { Kind9Renderer } from "./ChatMessageRenderer";
import { Kind20Renderer } from "./PictureRenderer";
import { Kind21Renderer } from "./VideoRenderer";
import { Kind22Renderer } from "./ShortVideoRenderer";
import { VoiceMessageRenderer } from "./VoiceMessageRenderer";
import { Kind1063Renderer } from "./FileMetadataRenderer";
import { Kind1337Renderer } from "./CodeSnippetRenderer";
import { Kind1337DetailRenderer } from "./CodeSnippetDetailRenderer";
import { IssueRenderer } from "./IssueRenderer";
import { IssueDetailRenderer } from "./IssueDetailRenderer";
import { PatchRenderer } from "./PatchRenderer";
import { PatchDetailRenderer } from "./PatchDetailRenderer";
import { PullRequestRenderer } from "./PullRequestRenderer";
import { PullRequestDetailRenderer } from "./PullRequestDetailRenderer";
import { Kind9735Renderer } from "./ZapReceiptRenderer";
import { Kind9802Renderer } from "./HighlightRenderer";
import { Kind9802DetailRenderer } from "./HighlightDetailRenderer";
import { Kind10002Renderer } from "./RelayListRenderer";
import { Kind10002DetailRenderer } from "./RelayListDetailRenderer";
import { Kind10317Renderer } from "./GraspListRenderer";
import { Kind10317DetailRenderer } from "./GraspListDetailRenderer";
import { Kind30023Renderer } from "./ArticleRenderer";
import { Kind30023DetailRenderer } from "./ArticleDetailRenderer";
import { CommunityNIPRenderer } from "./CommunityNIPRenderer";
import { CommunityNIPDetailRenderer } from "./CommunityNIPDetailRenderer";
import { RepositoryRenderer } from "./RepositoryRenderer";
import { RepositoryDetailRenderer } from "./RepositoryDetailRenderer";
import { RepositoryStateRenderer } from "./RepositoryStateRenderer";
import { RepositoryStateDetailRenderer } from "./RepositoryStateDetailRenderer";
import { Kind39701Renderer } from "./BookmarkRenderer";
import { GenericRelayListRenderer } from "./GenericRelayListRenderer";
import { LiveActivityRenderer } from "./LiveActivityRenderer";
import { LiveActivityDetailRenderer } from "./LiveActivityDetailRenderer";
import { SpellRenderer, SpellDetailRenderer } from "./SpellRenderer";
import {
  SpellbookRenderer,
  SpellbookDetailRenderer,
} from "./SpellbookRenderer";
import { ApplicationHandlerRenderer } from "./ApplicationHandlerRenderer";
import { ApplicationHandlerDetailRenderer } from "./ApplicationHandlerDetailRenderer";
import { HandlerRecommendationRenderer } from "./HandlerRecommendationRenderer";
import { HandlerRecommendationDetailRenderer } from "./HandlerRecommendationDetailRenderer";
import { CalendarDateEventRenderer } from "./CalendarDateEventRenderer";
import { CalendarDateEventDetailRenderer } from "./CalendarDateEventDetailRenderer";
import { CalendarTimeEventRenderer } from "./CalendarTimeEventRenderer";
import { CalendarTimeEventDetailRenderer } from "./CalendarTimeEventDetailRenderer";
import { EmojiSetRenderer } from "./EmojiSetRenderer";
import { EmojiSetDetailRenderer } from "./EmojiSetDetailRenderer";
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
  11: Kind1Renderer, // Public Thread Reply (NIP-10)
  16: RepostRenderer, // Generic Repost
  17: Kind7Renderer, // Reaction (NIP-25)
  20: Kind20Renderer, // Picture (NIP-68)
  21: Kind21Renderer, // Video Event (NIP-71)
  22: Kind22Renderer, // Short Video (NIP-71)
  1063: Kind1063Renderer, // File Metadata (NIP-94)
  1111: Kind1111Renderer, // Post (NIP-22)
  1222: VoiceMessageRenderer, // Voice Message (NIP-A0)
  1244: VoiceMessageRenderer, // Voice Message Reply (NIP-A0)
  1337: Kind1337Renderer, // Code Snippet (NIP-C0)
  1617: PatchRenderer, // Patch (NIP-34)
  1618: PullRequestRenderer, // Pull Request (NIP-34)
  1621: IssueRenderer, // Issue (NIP-34)
  9735: Kind9735Renderer, // Zap Receipt
  9802: Kind9802Renderer, // Highlight
  777: SpellRenderer, // Spell (Grimoire)
  10002: Kind10002Renderer, // Relay List Metadata (NIP-65)
  10317: Kind10317Renderer, // User Grasp List (NIP-34)
  10006: GenericRelayListRenderer, // Blocked Relays (NIP-51)
  10007: GenericRelayListRenderer, // Search Relays (NIP-51)
  10012: GenericRelayListRenderer, // Favorite Relays (NIP-51)
  10050: GenericRelayListRenderer, // DM Relay List (NIP-51)
  30002: GenericRelayListRenderer, // Relay Sets (NIP-51)
  30023: Kind30023Renderer, // Long-form Article
  30030: EmojiSetRenderer, // Emoji Sets (NIP-30)
  30311: LiveActivityRenderer, // Live Streaming Event (NIP-53)
  34235: Kind21Renderer, // Horizontal Video (NIP-71 legacy)
  34236: Kind22Renderer, // Vertical Video (NIP-71 legacy)
  30617: RepositoryRenderer, // Repository (NIP-34)
  30618: RepositoryStateRenderer, // Repository State (NIP-34)
  30777: SpellbookRenderer, // Spellbook (Grimoire)
  30817: CommunityNIPRenderer, // Community NIP
  31922: CalendarDateEventRenderer, // Date-Based Calendar Event (NIP-52)
  31923: CalendarTimeEventRenderer, // Time-Based Calendar Event (NIP-52)
  31989: HandlerRecommendationRenderer, // Handler Recommendation (NIP-89)
  31990: ApplicationHandlerRenderer, // Application Handler (NIP-89)
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
 * Registry of kind-specific detail renderers (for detail views)
 * Maps event kinds to their detailed renderer components
 */
const detailRenderers: Record<
  number,
  React.ComponentType<{ event: NostrEvent }>
> = {
  0: Kind0DetailRenderer, // Profile Metadata Detail
  3: Kind3DetailView, // Contact List Detail
  1337: Kind1337DetailRenderer, // Code Snippet Detail (NIP-C0)
  1617: PatchDetailRenderer, // Patch Detail (NIP-34)
  1618: PullRequestDetailRenderer, // Pull Request Detail (NIP-34)
  1621: IssueDetailRenderer, // Issue Detail (NIP-34)
  9802: Kind9802DetailRenderer, // Highlight Detail
  10002: Kind10002DetailRenderer, // Relay List Detail (NIP-65)
  10317: Kind10317DetailRenderer, // User Grasp List Detail (NIP-34)
  777: SpellDetailRenderer, // Spell Detail
  30023: Kind30023DetailRenderer, // Long-form Article Detail
  30030: EmojiSetDetailRenderer, // Emoji Sets Detail (NIP-30)
  30311: LiveActivityDetailRenderer, // Live Streaming Event Detail (NIP-53)
  30617: RepositoryDetailRenderer, // Repository Detail (NIP-34)
  30618: RepositoryStateDetailRenderer, // Repository State Detail (NIP-34)
  30777: SpellbookDetailRenderer, // Spellbook Detail (Grimoire)
  30817: CommunityNIPDetailRenderer, // Community NIP Detail
  31922: CalendarDateEventDetailRenderer, // Date-Based Calendar Event Detail (NIP-52)
  31923: CalendarTimeEventDetailRenderer, // Time-Based Calendar Event Detail (NIP-52)
  31989: HandlerRecommendationDetailRenderer, // Handler Recommendation Detail (NIP-89)
  31990: ApplicationHandlerDetailRenderer, // Application Handler Detail (NIP-89)
};

/**
 * Default detail renderer for kinds without custom detail implementations
 * Falls back to the feed renderer
 */
function DefaultDetailRenderer({ event }: { event: NostrEvent }) {
  return <KindRenderer event={event} depth={0} />;
}

/**
 * Main DetailKindRenderer component
 * Automatically selects the appropriate detail renderer based on event kind
 * Falls back to feed renderer if no detail renderer exists
 */
export function DetailKindRenderer({ event }: { event: NostrEvent }) {
  const Renderer = detailRenderers[event.kind] || DefaultDetailRenderer;
  return <Renderer event={event} />;
}

/**
 * Export kind renderers registry for dynamic kind detection
 */
export { kindRenderers, detailRenderers };

/**
 * Export individual renderers and base components for reuse
 */
export {
  BaseEventContainer,
  EventAuthor,
  EventMenu,
} from "./BaseEventRenderer";
export type { BaseEventProps } from "./BaseEventRenderer";
export { Kind1Renderer } from "./NoteRenderer";
export { Kind1111Renderer } from "./Kind1111Renderer";
export {
  RepostRenderer,
  Kind6Renderer,
  Kind16Renderer,
} from "./RepostRenderer";
export { Kind7Renderer } from "./ReactionRenderer";
export { Kind9Renderer } from "./ChatMessageRenderer";
export { Kind20Renderer } from "./PictureRenderer";
export { Kind21Renderer } from "./VideoRenderer";
export { Kind22Renderer } from "./ShortVideoRenderer";
export { VoiceMessageRenderer } from "./VoiceMessageRenderer";
export { Kind1063Renderer } from "./FileMetadataRenderer";
export { Kind9735Renderer } from "./ZapReceiptRenderer";
