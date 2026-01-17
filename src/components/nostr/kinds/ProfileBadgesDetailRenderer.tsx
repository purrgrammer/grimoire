import { NostrEvent } from "@/types/nostr";
import { getProfileBadgePairs } from "@/lib/nip58-helpers";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { AddressPointer } from "nostr-tools/nip19";
import {
  getBadgeName,
  getBadgeIdentifier,
  getBadgeDescription,
  getBadgeImageUrl,
} from "@/lib/nip58-helpers";
import { Award } from "lucide-react";
import { UserName } from "../UserName";
import { ClickableEventTitle } from "./BaseEventRenderer";

interface ProfileBadgesDetailRendererProps {
  event: NostrEvent;
}

/**
 * Parse an address pointer from an a tag value
 * Format: "kind:pubkey:identifier"
 */
function parseAddress(aTagValue: string): AddressPointer | null {
  const parts = aTagValue.split(":");
  if (parts.length !== 3) return null;

  const kind = parseInt(parts[0], 10);
  const pubkey = parts[1];
  const identifier = parts[2];

  if (isNaN(kind) || !pubkey || identifier === undefined) return null;

  return { kind, pubkey, identifier };
}

/**
 * Single badge row component with author, image, name, and description
 */
function BadgeRow({
  badgeAddress,
  awardEventId,
}: {
  badgeAddress: string;
  awardEventId: string;
}) {
  const coordinate = parseAddress(badgeAddress);

  // Fetch the badge definition event
  const badgeEvent = use$(
    () =>
      coordinate
        ? eventStore.replaceable(
            coordinate.kind,
            coordinate.pubkey,
            coordinate.identifier,
          )
        : undefined,
    [coordinate?.kind, coordinate?.pubkey, coordinate?.identifier],
  );

  // Fetch the award event
  const awardEvent = use$(() => eventStore.event(awardEventId), [awardEventId]);

  const badgeName = badgeEvent ? getBadgeName(badgeEvent) : null;
  const badgeIdentifier = badgeEvent ? getBadgeIdentifier(badgeEvent) : null;
  const badgeDescription = badgeEvent ? getBadgeDescription(badgeEvent) : null;
  const badgeImageUrl = badgeEvent ? getBadgeImageUrl(badgeEvent) : null;

  const displayTitle = badgeName || badgeIdentifier || "Badge";

  return (
    <div className="flex gap-4 items-start p-4 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
      {/* Badge Image */}
      {badgeImageUrl ? (
        <img
          src={badgeImageUrl}
          alt={displayTitle}
          className="size-24 rounded-lg object-cover flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="size-24 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Award className="size-12 text-muted-foreground" />
        </div>
      )}

      {/* Badge Info */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {/* Issuer */}
        {awardEvent && (
          <div className="text-xs">
            <UserName pubkey={awardEvent.pubkey} />
          </div>
        )}

        {/* Badge Name */}
        {badgeEvent ? (
          <ClickableEventTitle
            event={badgeEvent}
            className="text-lg font-semibold text-foreground"
          >
            {displayTitle}
          </ClickableEventTitle>
        ) : (
          <h3 className="text-lg font-semibold text-foreground">
            {displayTitle}
          </h3>
        )}

        {/* Badge Description */}
        {badgeDescription && (
          <p className="text-sm text-muted-foreground">{badgeDescription}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Detail renderer for Kind 30008 - Profile Badges (NIP-58)
 * Shows all badges in a vertical list
 */
export function ProfileBadgesDetailRenderer({
  event,
}: ProfileBadgesDetailRendererProps) {
  const badgePairs = getProfileBadgePairs(event);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Profile Badges</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <UserName pubkey={event.pubkey} />
          <span>•</span>
          <span>
            {badgePairs.length} {badgePairs.length === 1 ? "badge" : "badges"}
          </span>
        </div>
      </div>

      {/* Badges List */}
      {badgePairs.length > 0 ? (
        <div className="flex flex-col gap-3">
          {badgePairs.map((pair, idx) => (
            <BadgeRow
              key={idx}
              badgeAddress={pair.badgeAddress}
              awardEventId={pair.awardEventId}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
          <Award className="size-12" />
          <p className="text-lg">No badges to display</p>
        </div>
      )}
    </div>
  );
}
