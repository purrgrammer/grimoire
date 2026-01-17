import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { getProfileBadgePairs } from "@/lib/nip58-helpers";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { AddressPointer } from "nostr-tools/nip19";
import {
  getBadgeName,
  getBadgeIdentifier,
  getBadgeImageUrl,
} from "@/lib/nip58-helpers";
import { Award } from "lucide-react";

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
 * Single badge display component for feed view
 */
function BadgeItem({ badgeAddress }: { badgeAddress: string }) {
  const coordinate = parseAddress(badgeAddress);

  // Fetch the badge event
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

  const badgeName = badgeEvent ? getBadgeName(badgeEvent) : null;
  const badgeIdentifier = badgeEvent ? getBadgeIdentifier(badgeEvent) : null;
  const badgeImageUrl = badgeEvent ? getBadgeImageUrl(badgeEvent) : null;

  const displayTitle = badgeName || badgeIdentifier || "Badge";

  return (
    <div className="flex items-center gap-1.5" title={displayTitle}>
      {badgeImageUrl ? (
        <img
          src={badgeImageUrl}
          alt={displayTitle}
          className="size-6 rounded object-cover flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <Award className="size-6 text-muted-foreground flex-shrink-0" />
      )}
    </div>
  );
}

/**
 * Renderer for Kind 30008 - Profile Badges (NIP-58)
 * Shows limited badge thumbnails with "& n more" pattern, clickable to open detail view
 */
export function ProfileBadgesRenderer({ event }: BaseEventProps) {
  const badgePairs = getProfileBadgePairs(event);
  const MAX_VISIBLE_BADGES = 5;
  const visibleBadges = badgePairs.slice(0, MAX_VISIBLE_BADGES);
  const remainingCount = Math.max(0, badgePairs.length - MAX_VISIBLE_BADGES);

  if (badgePairs.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Award className="size-5" />
          <span>No badges</span>
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Badge Count - Clickable Title */}
        <ClickableEventTitle
          event={event}
          className="text-sm font-semibold text-foreground hover:text-foreground/80"
        >
          {badgePairs.length} {badgePairs.length === 1 ? "badge" : "badges"}
        </ClickableEventTitle>

        {/* Limited Badge Thumbnails */}
        <div className="flex items-center gap-2 flex-wrap">
          {visibleBadges.map((pair, idx) => (
            <BadgeItem key={idx} badgeAddress={pair.badgeAddress} />
          ))}
          {remainingCount > 0 && (
            <span className="text-sm text-muted-foreground">
              & {remainingCount} more
            </span>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
