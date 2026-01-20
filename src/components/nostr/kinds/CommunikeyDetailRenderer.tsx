import type { NostrEvent } from "@/types/nostr";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  getCommunityRelays,
  getCommunityDescription,
  getCommunityContentSections,
  getCommunityBlossomServers,
  getCommunityMints,
  getCommunityLocation,
  getCommunityGeohash,
  getCommunityTos,
  getCommunityBadgeRequirements,
  type ContentSection,
} from "@/lib/communikeys-helpers";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import {
  Users2,
  Server,
  MapPin,
  Layers,
  Award,
  FileText,
  Flower2,
  Coins,
  ExternalLink,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { useCopy } from "@/hooks/useCopy";

interface CommunikeyDetailRendererProps {
  event: NostrEvent;
}

/**
 * Content Section Card Component
 */
function ContentSectionCard({ section }: { section: ContentSection }) {
  return (
    <div className="border border-border rounded-lg p-4 flex flex-col gap-2">
      <h3 className="font-semibold text-base flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        {section.name}
      </h3>

      {/* Event Kinds */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Allowed Kinds</span>
        <div className="flex flex-wrap gap-1">
          {section.kinds.map((kind) => (
            <code
              key={kind}
              className="px-2 py-0.5 text-xs bg-muted rounded font-mono"
            >
              {kind}
            </code>
          ))}
        </div>
      </div>

      {/* Badge Requirements */}
      {section.badgePointers.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Award className="size-3" />
            Required Badges (any)
          </span>
          <div className="flex flex-col gap-1">
            {section.badgePointers.map((pointer, idx) => (
              <code
                key={idx}
                className="text-xs bg-muted rounded p-1 font-mono truncate"
                title={pointer}
              >
                {pointer}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Detail renderer for Communikeys events (kind 10222)
 * Shows full community information including all content sections,
 * infrastructure (relays, blossom servers, mints), and metadata
 */
export function CommunikeyDetailRenderer({
  event,
}: CommunikeyDetailRendererProps) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();

  // Community's identity comes from the pubkey's profile
  const profile = useProfile(event.pubkey);
  const displayName = getDisplayName(event.pubkey, profile);

  // Extract all community metadata
  const relays = getCommunityRelays(event);
  const description = getCommunityDescription(event);
  const contentSections = getCommunityContentSections(event);
  const blossomServers = getCommunityBlossomServers(event);
  const mints = getCommunityMints(event);
  const location = getCommunityLocation(event);
  const geohash = getCommunityGeohash(event);
  const tos = getCommunityTos(event);
  const badgeRequirements = getCommunityBadgeRequirements(event);

  // Generate ncommunity identifier
  const npub = nip19.npubEncode(event.pubkey);

  const handleCopyNpub = () => {
    copy(npub);
  };

  const handleOpenProfile = () => {
    addWindow("profile", { pubkey: event.pubkey });
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header Section */}
      <div className="flex gap-4">
        {/* Community Avatar */}
        {profile?.picture ? (
          <img
            src={profile.picture}
            alt={displayName}
            className="size-24 md:size-32 rounded-xl object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-24 md:size-32 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
            <Users2 className="size-12 text-muted-foreground" />
          </div>
        )}

        {/* Community Title & Description */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Users2 className="size-6 md:size-8 text-muted-foreground" />
            {displayName}
          </h1>
          {description && (
            <p className="text-muted-foreground text-sm md:text-base">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        {/* Admin/Owner */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground flex items-center gap-1">
            Admin
          </h3>
          <div className="flex items-center gap-2">
            <UserName pubkey={event.pubkey} />
            <button
              onClick={handleOpenProfile}
              className="text-muted-foreground hover:text-foreground"
              title="Open Profile"
            >
              <ExternalLink className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Community ID */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Community ID</h3>
          <div className="flex items-center gap-2">
            <code
              className="font-mono text-xs truncate flex-1 cursor-pointer hover:text-primary"
              title={npub}
              onClick={handleCopyNpub}
            >
              {npub.slice(0, 20)}...{npub.slice(-8)}
            </code>
            <span className="text-xs text-muted-foreground">
              {copied ? "Copied!" : "Click to copy"}
            </span>
          </div>
        </div>

        {/* Location */}
        {location && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground flex items-center gap-1">
              <MapPin className="size-3.5" />
              Location
            </h3>
            <span>{location}</span>
          </div>
        )}

        {/* Geohash */}
        {geohash && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Geohash</h3>
            <code className="font-mono text-xs">{geohash}</code>
          </div>
        )}
      </div>

      {/* Content Sections */}
      {contentSections.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Layers className="size-5" />
            Content Sections
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {contentSections.map((section, idx) => (
              <ContentSectionCard key={idx} section={section} />
            ))}
          </div>
        </div>
      )}

      {/* Infrastructure Section */}
      {(relays.length > 0 || blossomServers.length > 0 || mints.length > 0) && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Infrastructure</h2>

          {/* Relays */}
          {relays.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm text-muted-foreground flex items-center gap-1">
                <Server className="size-3.5" />
                Relays ({relays.length})
              </h3>
              <div className="flex flex-col gap-1">
                {relays.map((relay, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <code className="text-xs bg-muted rounded px-2 py-1 font-mono truncate">
                      {relay}
                    </code>
                    {idx === 0 && (
                      <span className="text-xs text-primary">(main)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blossom Servers */}
          {blossomServers.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm text-muted-foreground flex items-center gap-1">
                <Flower2 className="size-3.5" />
                Blossom Servers ({blossomServers.length})
              </h3>
              <div className="flex flex-col gap-1">
                {blossomServers.map((server, idx) => (
                  <code
                    key={idx}
                    className="text-xs bg-muted rounded px-2 py-1 font-mono truncate"
                  >
                    {server}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Mints */}
          {mints.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm text-muted-foreground flex items-center gap-1">
                <Coins className="size-3.5" />
                Ecash Mints ({mints.length})
              </h3>
              <div className="flex flex-col gap-1">
                {mints.map((mint, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <code className="text-xs bg-muted rounded px-2 py-1 font-mono truncate">
                      {mint.url}
                    </code>
                    {mint.type && (
                      <span className="text-xs text-muted-foreground">
                        ({mint.type})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Badge Requirements Summary */}
      {badgeRequirements.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Award className="size-5" />
            Required Badges
          </h2>
          <p className="text-sm text-muted-foreground">
            Users need one of these badges to publish content in this community:
          </p>
          <div className="flex flex-col gap-1">
            {badgeRequirements.map((badge, idx) => (
              <code
                key={idx}
                className="text-xs bg-muted rounded px-2 py-1 font-mono truncate"
                title={badge}
              >
                {badge}
              </code>
            ))}
          </div>
        </div>
      )}

      {/* Terms of Service */}
      {tos && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="size-5" />
            Terms of Service
          </h2>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted rounded px-2 py-1 font-mono truncate">
              {tos.reference}
            </code>
            {tos.relay && (
              <span className="text-xs text-muted-foreground">
                via {tos.relay}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
