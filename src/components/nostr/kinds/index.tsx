import { Kind0Renderer } from "./ProfileRenderer";
import { Kind0DetailRenderer } from "./ProfileDetailRenderer";
import { Kind1Renderer } from "./NoteRenderer";
import { Kind1111Renderer } from "./Kind1111Renderer";
import { Kind3Renderer } from "./ContactListRenderer";
import { Kind3DetailView } from "./ContactListRenderer";
import { RepostRenderer } from "./RepostRenderer";
import { Kind7Renderer } from "./ReactionRenderer";
import { Kind9Renderer } from "./ChatMessageRenderer";
import { LiveChatMessageRenderer } from "./LiveChatMessageRenderer";
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
import {
  BlossomServerListRenderer,
  BlossomServerListDetailRenderer,
} from "./BlossomServerListRenderer";
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
import { PublicChatsRenderer } from "./PublicChatsRenderer";
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
import { ZapstoreAppRenderer } from "./ZapstoreAppRenderer";
import { ZapstoreAppDetailRenderer } from "./ZapstoreAppDetailRenderer";
import { ZapstoreAppSetRenderer } from "./ZapstoreAppSetRenderer";
import { ZapstoreAppSetDetailRenderer } from "./ZapstoreAppSetDetailRenderer";
import { ZapstoreReleaseRenderer } from "./ZapstoreReleaseRenderer";
import { ZapstoreReleaseDetailRenderer } from "./ZapstoreReleaseDetailRenderer";
import { GroupMetadataRenderer } from "./GroupMetadataRenderer";
import {
  RelayMembersRenderer,
  RelayMembersDetailRenderer,
} from "./RelayMembersRenderer";
import {
  AddUserRenderer,
  AddUserDetailRenderer,
  RemoveUserRenderer,
  RemoveUserDetailRenderer,
} from "./RelayUserChangeRenderer";
// NIP-51 List Renderers
import { MuteListRenderer, MuteListDetailRenderer } from "./MuteListRenderer";
import { PinListRenderer, PinListDetailRenderer } from "./PinListRenderer";
import {
  BookmarkListRenderer,
  BookmarkListDetailRenderer,
} from "./BookmarkListRenderer";
import {
  CommunityListRenderer,
  CommunityListDetailRenderer,
} from "./CommunityListRenderer";
import {
  ChannelListRenderer,
  ChannelListDetailRenderer,
} from "./ChannelListRenderer";
import {
  InterestListRenderer,
  InterestListDetailRenderer,
  InterestSetRenderer,
  InterestSetDetailRenderer,
} from "./InterestListRenderer";
import {
  MediaFollowListRenderer,
  MediaFollowListDetailRenderer,
} from "./MediaFollowListRenderer";
import {
  EmojiListRenderer,
  EmojiListDetailRenderer,
} from "./EmojiListRenderer";
import {
  WikiAuthorsRenderer,
  WikiAuthorsDetailRenderer,
  WikiRelaysRenderer,
  WikiRelaysDetailRenderer,
} from "./WikiListRenderer";
import {
  FollowSetRenderer,
  FollowSetDetailRenderer,
} from "./FollowSetRenderer";
import {
  BookmarkSetRenderer,
  BookmarkSetDetailRenderer,
} from "./BookmarkSetRenderer";
import {
  ArticleCurationSetRenderer,
  ArticleCurationSetDetailRenderer,
  VideoCurationSetRenderer,
  VideoCurationSetDetailRenderer,
  PictureCurationSetRenderer,
  PictureCurationSetDetailRenderer,
} from "./CurationSetRenderer";
import {
  KindMuteSetRenderer,
  KindMuteSetDetailRenderer,
} from "./KindMuteSetRenderer";
import {
  StarterPackRenderer,
  StarterPackDetailRenderer,
  MediaStarterPackRenderer,
  MediaStarterPackDetailRenderer,
} from "./StarterPackRenderer";
import { NostrEvent } from "@/types/nostr";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { P2pOrderRenderer } from "./P2pOrderRenderer";
import { P2pOrderDetailRenderer } from "./P2pOrderDetailRenderer";
import { BadgeDefinitionRenderer } from "./BadgeDefinitionRenderer";
import { BadgeDefinitionDetailRenderer } from "./BadgeDefinitionDetailRenderer";
import { BadgeAwardRenderer } from "./BadgeAwardRenderer";
import { BadgeAwardDetailRenderer } from "./BadgeAwardDetailRenderer";
import { ProfileBadgesRenderer } from "./ProfileBadgesRenderer";
import { ProfileBadgesDetailRenderer } from "./ProfileBadgesDetailRenderer";
import { MonitorAnnouncementRenderer } from "./MonitorAnnouncementRenderer";
import { MonitorAnnouncementDetailRenderer } from "./MonitorAnnouncementDetailRenderer";
import { RelayDiscoveryRenderer } from "./RelayDiscoveryRenderer";
import { RelayDiscoveryDetailRenderer } from "./RelayDiscoveryDetailRenderer";
import { GoalRenderer } from "./GoalRenderer";
import { GoalDetailRenderer } from "./GoalDetailRenderer";
import { PollRenderer } from "./PollRenderer";
import { PollDetailRenderer } from "./PollDetailRenderer";
import { PollResponseRenderer } from "./PollResponseRenderer";

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
  8: BadgeAwardRenderer, // Badge Award (NIP-58)
  9: Kind9Renderer, // Chat Message (NIP-C7)
  11: Kind1Renderer, // Public Thread Reply (NIP-10)
  16: RepostRenderer, // Generic Repost
  17: Kind7Renderer, // Reaction (NIP-25)
  20: Kind20Renderer, // Picture (NIP-68)
  21: Kind21Renderer, // Video Event (NIP-71)
  22: Kind22Renderer, // Short Video (NIP-71)
  1018: PollResponseRenderer, // Poll Response (NIP-88)
  1063: Kind1063Renderer, // File Metadata (NIP-94)
  1068: PollRenderer, // Poll (NIP-88)
  1111: Kind1111Renderer, // Post (NIP-22)
  1222: VoiceMessageRenderer, // Voice Message (NIP-A0)
  1311: LiveChatMessageRenderer, // Live Chat Message (NIP-53)
  1244: VoiceMessageRenderer, // Voice Message Reply (NIP-A0)
  1337: Kind1337Renderer, // Code Snippet (NIP-C0)
  1617: PatchRenderer, // Patch (NIP-34)
  1618: PullRequestRenderer, // Pull Request (NIP-34)
  1621: IssueRenderer, // Issue (NIP-34)
  9041: GoalRenderer, // Zap Goal (NIP-75)
  9735: Kind9735Renderer, // Zap Receipt
  9802: Kind9802Renderer, // Highlight
  8000: AddUserRenderer, // Add User (NIP-43)
  8001: RemoveUserRenderer, // Remove User (NIP-43)
  777: SpellRenderer, // Spell (Grimoire)
  10000: MuteListRenderer, // Mute List (NIP-51)
  10001: PinListRenderer, // Pin List (NIP-51)
  10002: Kind10002Renderer, // Relay List Metadata (NIP-65)
  10003: BookmarkListRenderer, // Bookmark List (NIP-51)
  10004: CommunityListRenderer, // Community List (NIP-51)
  10005: ChannelListRenderer, // Public Chats/Channels List (NIP-51)
  10006: GenericRelayListRenderer, // Blocked Relays (NIP-51)
  10007: GenericRelayListRenderer, // Search Relays (NIP-51)
  10009: PublicChatsRenderer, // User Groups List (NIP-51)
  10012: GenericRelayListRenderer, // Favorite Relays (NIP-51)
  10015: InterestListRenderer, // Interest List (NIP-51)
  10020: MediaFollowListRenderer, // Media Follow List (NIP-51)
  10030: EmojiListRenderer, // User Emoji List (NIP-51)
  10050: GenericRelayListRenderer, // DM Relay List (NIP-51)
  10063: BlossomServerListRenderer, // Blossom User Server List (BUD-03)
  10101: WikiAuthorsRenderer, // Good Wiki Authors (NIP-51)
  10102: WikiRelaysRenderer, // Good Wiki Relays (NIP-51)
  10166: MonitorAnnouncementRenderer, // Relay Monitor Announcement (NIP-66)
  10317: Kind10317Renderer, // User Grasp List (NIP-34)
  13534: RelayMembersRenderer, // Relay Members (NIP-43)
  30000: FollowSetRenderer, // Follow Sets (NIP-51)
  30002: GenericRelayListRenderer, // Relay Sets (NIP-51)
  30003: BookmarkSetRenderer, // Bookmark Sets (NIP-51)
  30004: ArticleCurationSetRenderer, // Article Curation Sets (NIP-51)
  30005: VideoCurationSetRenderer, // Video Curation Sets (NIP-51)
  30006: PictureCurationSetRenderer, // Picture Curation Sets (NIP-51)
  30007: KindMuteSetRenderer, // Kind Mute Sets (NIP-51)
  30008: ProfileBadgesRenderer, // Profile Badges (NIP-58)
  30009: BadgeDefinitionRenderer, // Badge (NIP-58)
  30015: InterestSetRenderer, // Interest Sets (NIP-51)
  30023: Kind30023Renderer, // Long-form Article
  30030: EmojiSetRenderer, // Emoji Sets (NIP-30)
  30063: ZapstoreReleaseRenderer, // Zapstore App Release
  30166: RelayDiscoveryRenderer, // Relay Discovery (NIP-66)
  30267: ZapstoreAppSetRenderer, // Zapstore App Collection
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
  32267: ZapstoreAppRenderer, // Zapstore App
  38383: P2pOrderRenderer, // P2P Orders
  39000: GroupMetadataRenderer, // Group Metadata (NIP-29)
  39089: StarterPackRenderer, // Starter Pack (NIP-51)
  39092: MediaStarterPackRenderer, // Media Starter Pack (NIP-51)
  39701: Kind39701Renderer, // Web Bookmarks (NIP-B0)
};

/**
 * Default renderer for kinds without custom implementations
 * Shows basic event info with raw content
 * Right-click or tap menu button to access event menu
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
  8: BadgeAwardDetailRenderer, // Badge Award Detail (NIP-58)
  777: SpellDetailRenderer, // Spell Detail
  1068: PollDetailRenderer, // Poll Detail (NIP-88)
  1337: Kind1337DetailRenderer, // Code Snippet Detail (NIP-C0)
  1617: PatchDetailRenderer, // Patch Detail (NIP-34)
  1618: PullRequestDetailRenderer, // Pull Request Detail (NIP-34)
  1621: IssueDetailRenderer, // Issue Detail (NIP-34)
  9041: GoalDetailRenderer, // Zap Goal Detail (NIP-75)
  9802: Kind9802DetailRenderer, // Highlight Detail
  8000: AddUserDetailRenderer, // Add User Detail (NIP-43)
  8001: RemoveUserDetailRenderer, // Remove User Detail (NIP-43)
  10000: MuteListDetailRenderer, // Mute List Detail (NIP-51)
  10001: PinListDetailRenderer, // Pin List Detail (NIP-51)
  10002: Kind10002DetailRenderer, // Relay List Detail (NIP-65)
  10003: BookmarkListDetailRenderer, // Bookmark List Detail (NIP-51)
  10004: CommunityListDetailRenderer, // Community List Detail (NIP-51)
  10005: ChannelListDetailRenderer, // Channel List Detail (NIP-51)
  10015: InterestListDetailRenderer, // Interest List Detail (NIP-51)
  10020: MediaFollowListDetailRenderer, // Media Follow List Detail (NIP-51)
  10030: EmojiListDetailRenderer, // User Emoji List Detail (NIP-51)
  10063: BlossomServerListDetailRenderer, // Blossom User Server List Detail (BUD-03)
  10101: WikiAuthorsDetailRenderer, // Good Wiki Authors Detail (NIP-51)
  10102: WikiRelaysDetailRenderer, // Good Wiki Relays Detail (NIP-51)
  10166: MonitorAnnouncementDetailRenderer, // Relay Monitor Announcement Detail (NIP-66)
  10317: Kind10317DetailRenderer, // User Grasp List Detail (NIP-34)
  13534: RelayMembersDetailRenderer, // Relay Members Detail (NIP-43)
  30000: FollowSetDetailRenderer, // Follow Sets Detail (NIP-51)
  30003: BookmarkSetDetailRenderer, // Bookmark Sets Detail (NIP-51)
  30004: ArticleCurationSetDetailRenderer, // Article Curation Sets Detail (NIP-51)
  30005: VideoCurationSetDetailRenderer, // Video Curation Sets Detail (NIP-51)
  30006: PictureCurationSetDetailRenderer, // Picture Curation Sets Detail (NIP-51)
  30007: KindMuteSetDetailRenderer, // Kind Mute Sets Detail (NIP-51)
  30008: ProfileBadgesDetailRenderer, // Profile Badges Detail (NIP-58)
  30009: BadgeDefinitionDetailRenderer, // Badge Detail (NIP-58)
  30015: InterestSetDetailRenderer, // Interest Sets Detail (NIP-51)
  30023: Kind30023DetailRenderer, // Long-form Article Detail
  30030: EmojiSetDetailRenderer, // Emoji Sets Detail (NIP-30)
  30063: ZapstoreReleaseDetailRenderer, // Zapstore App Release Detail
  30166: RelayDiscoveryDetailRenderer, // Relay Discovery Detail (NIP-66)
  30267: ZapstoreAppSetDetailRenderer, // Zapstore App Collection Detail
  30311: LiveActivityDetailRenderer, // Live Streaming Event Detail (NIP-53)
  30617: RepositoryDetailRenderer, // Repository Detail (NIP-34)
  30618: RepositoryStateDetailRenderer, // Repository State Detail (NIP-34)
  30777: SpellbookDetailRenderer, // Spellbook Detail (Grimoire)
  30817: CommunityNIPDetailRenderer, // Community NIP Detail
  31922: CalendarDateEventDetailRenderer, // Date-Based Calendar Event Detail (NIP-52)
  31923: CalendarTimeEventDetailRenderer, // Time-Based Calendar Event Detail (NIP-52)
  31989: HandlerRecommendationDetailRenderer, // Handler Recommendation Detail (NIP-89)
  31990: ApplicationHandlerDetailRenderer, // Application Handler Detail (NIP-89)
  32267: ZapstoreAppDetailRenderer, // Zapstore App Detail
  38383: P2pOrderDetailRenderer, // P2P Order Detail
  39089: StarterPackDetailRenderer, // Starter Pack Detail (NIP-51)
  39092: MediaStarterPackDetailRenderer, // Media Starter Pack Detail (NIP-51)
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
  EventContextMenu,
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
export {
  LiveChatMessageRenderer,
  Kind1311Renderer,
} from "./LiveChatMessageRenderer";
export { Kind20Renderer } from "./PictureRenderer";
export { Kind21Renderer } from "./VideoRenderer";
export { Kind22Renderer } from "./ShortVideoRenderer";
export { VoiceMessageRenderer } from "./VoiceMessageRenderer";
export { Kind1063Renderer } from "./FileMetadataRenderer";
export { Kind9735Renderer } from "./ZapReceiptRenderer";
