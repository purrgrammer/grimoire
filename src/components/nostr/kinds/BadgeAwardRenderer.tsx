import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { getAwardBadgeAddress, getAwardedPubkeys } from "@/lib/nip58-helpers";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { AddressPointer } from "nostr-tools/nip19";
import {
  getBadgeName,
  getBadgeIdentifier,
  getBadgeImageUrl,
} from "@/lib/nip58-helpers";
import { Award } from "lucide-react";
import { UserName } from "../UserName";

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
 * Renderer for Kind 8 - Badge Award (NIP-58)
 * Shows inline badge thumbnail, name, and linked recipient count
 */
export function BadgeAwardRenderer({ event }: BaseEventProps) {
  const badgeAddress = getAwardBadgeAddress(event);
  const awardedPubkeys = getAwardedPubkeys(event);

  // Parse the badge address (30009:pubkey:identifier)
  const coordinate = badgeAddress ? parseAddress(badgeAddress) : null;

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

  // Get badge metadata
  const badgeName = badgeEvent ? getBadgeName(badgeEvent) : null;
  const badgeIdentifier = badgeEvent ? getBadgeIdentifier(badgeEvent) : null;
  const badgeImageUrl = badgeEvent ? getBadgeImageUrl(badgeEvent) : null;

  const displayTitle = badgeName || badgeIdentifier || "Badge";
  const recipientCount = awardedPubkeys.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Badge Thumbnail - small inline */}
        {badgeImageUrl ? (
          <img
            src={badgeImageUrl}
            alt={displayTitle}
            className="size-5 rounded object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <Award className="size-5 text-muted-foreground flex-shrink-0" />
        )}

        {/* Badge Name - linked to badge event */}
        {badgeEvent ? (
          <ClickableEventTitle
            event={badgeEvent}
            className="text-sm font-semibold text-foreground"
          >
            {displayTitle}
          </ClickableEventTitle>
        ) : (
          <span className="text-sm font-semibold text-foreground">
            {displayTitle}
          </span>
        )}

        {/* Awarded count/name - linked to this award event */}
        <ClickableEventTitle
          event={event}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <span>awarded to</span>
          {recipientCount === 1 ? (
            <UserName pubkey={awardedPubkeys[0]} />
          ) : (
            <span>{recipientCount} people</span>
          )}
        </ClickableEventTitle>
      </div>
    </BaseEventContainer>
  );
}
