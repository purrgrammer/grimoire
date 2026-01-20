import type { NostrEvent } from "@/types/nostr";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  getCommunityRelays,
  getCommunityDescription,
  getCommunityContentSections,
  getCommunityLocation,
} from "@/lib/communikeys-helpers";
import { BaseEventContainer, ClickableEventTitle } from "./BaseEventRenderer";
import { useGrimoire } from "@/core/state";
import { Users2, Server, MapPin, Layers } from "lucide-react";

interface CommunikeyRendererProps {
  event: NostrEvent;
}

/**
 * Renderer for Communikeys events (kind 10222)
 * Displays community info with name/image from profile metadata
 * and community-specific data from the event tags
 */
export function CommunikeyRenderer({ event }: CommunikeyRendererProps) {
  const { addWindow } = useGrimoire();

  // Community's identity comes from the pubkey's profile
  const profile = useProfile(event.pubkey);
  const displayName = getDisplayName(event.pubkey, profile);

  // Extract community metadata from event tags
  const relays = getCommunityRelays(event);
  const description = getCommunityDescription(event);
  const contentSections = getCommunityContentSections(event);
  const location = getCommunityLocation(event);

  const handleOpenCommunity = () => {
    addWindow("community", {
      pubkey: event.pubkey,
      relays: relays.length > 0 ? relays : undefined,
    });
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex gap-3">
        {/* Community Avatar */}
        {profile?.picture && (
          <div className="flex-shrink-0">
            <img
              src={profile.picture}
              alt={displayName}
              className="size-12 rounded-lg object-cover"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {/* Community Name */}
          <ClickableEventTitle
            event={event}
            className="font-semibold text-base flex items-center gap-2"
          >
            <Users2 className="size-4 text-muted-foreground" />
            {displayName}
          </ClickableEventTitle>

          {/* Description */}
          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}

          {/* Metadata Row */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {/* Relay Count */}
            {relays.length > 0 && (
              <span className="flex items-center gap-1">
                <Server className="size-3" />
                {relays.length} {relays.length === 1 ? "relay" : "relays"}
              </span>
            )}

            {/* Content Sections */}
            {contentSections.length > 0 && (
              <span className="flex items-center gap-1">
                <Layers className="size-3" />
                {contentSections.length}{" "}
                {contentSections.length === 1 ? "section" : "sections"}
              </span>
            )}

            {/* Location */}
            {location && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" />
                {location}
              </span>
            )}
          </div>

          {/* Open Community Button */}
          <button
            onClick={handleOpenCommunity}
            className="text-xs text-primary hover:underline flex items-center gap-1 w-fit mt-1"
          >
            <Users2 className="size-3" />
            View Community
          </button>
        </div>
      </div>
    </BaseEventContainer>
  );
}
