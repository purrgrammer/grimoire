import { NostrEvent } from "@/types/nostr";
import {
  getBadgeIdentifier,
  getBadgeName,
  getBadgeDescription,
  getBadgeImage,
  getBadgeThumbnails,
} from "@/lib/nip58-helpers";
import { UserName } from "../UserName";
import { Award } from "lucide-react";
import { useMemo } from "react";
import { useLiveTimeline } from "@/hooks/useLiveTimeline";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { relayListCache } from "@/services/relay-list-cache";

interface BadgeDefinitionDetailRendererProps {
  event: NostrEvent;
}

/**
 * Image variant display component
 */
function ImageVariant({
  url,
  dimensions,
  label,
}: {
  url: string;
  dimensions?: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        {dimensions && (
          <code className="text-xs text-muted-foreground">{dimensions}</code>
        )}
      </div>
      <img
        src={url}
        alt={label}
        className="w-full max-w-[200px] rounded-lg object-cover"
        loading="lazy"
      />
    </div>
  );
}

/**
 * Detail renderer for Kind 30009 - Badge Definition (NIP-58)
 * Shows comprehensive badge information including all image variants
 */
export function BadgeDefinitionDetailRenderer({
  event,
}: BadgeDefinitionDetailRendererProps) {
  const identifier = getBadgeIdentifier(event);
  const name = getBadgeName(event);
  const description = getBadgeDescription(event);
  const image = getBadgeImage(event);
  const thumbnails = getBadgeThumbnails(event);

  // Use name if available, fallback to identifier
  const displayTitle = name || identifier || "Badge";

  // Build relay list for fetching badge awards (kind 8)
  const relays = useMemo(() => {
    const relaySet = new Set<string>();

    // Add seen relays from the badge definition event
    const seenRelays = getSeenRelays(event);
    if (seenRelays) {
      for (const relay of seenRelays) {
        relaySet.add(relay);
      }
    }

    // Add issuer's outbox relays
    const outboxRelays = relayListCache.getOutboxRelaysSync(event.pubkey);
    if (outboxRelays) {
      for (const relay of outboxRelays.slice(0, 3)) {
        relaySet.add(relay);
      }
    }

    return Array.from(relaySet);
  }, [event]);

  // Query for awards (kind 8) that reference this badge definition
  const awardsFilter = useMemo(() => {
    if (!identifier) {
      return { kinds: [8], ids: [] }; // No match if no identifier
    }
    return {
      kinds: [8],
      "#a": [`30009:${event.pubkey}:${identifier}`],
    };
  }, [event.pubkey, identifier]);

  // Fetch awards from relays
  const { events: awards } = useLiveTimeline(
    `badge-awards-${event.id}`,
    awardsFilter,
    relays,
    { limit: 100 },
  );

  // Count unique recipients
  const uniqueRecipients = useMemo(() => {
    if (!awards || awards.length === 0) return 0;
    const recipients = new Set<string>();
    for (const award of awards) {
      const pTags = award.tags.filter((tag) => tag[0] === "p" && tag[1]);
      for (const pTag of pTags) {
        recipients.add(pTag[1]);
      }
    }
    return recipients.size;
  }, [awards]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header Section */}
      <div className="flex gap-4">
        {/* Badge Image */}
        {image ? (
          <img
            src={image.url}
            alt={displayTitle}
            className="size-32 rounded-lg object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-32 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Award className="size-16 text-muted-foreground" />
          </div>
        )}

        {/* Badge Title & Description */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <h1 className="text-3xl font-bold">{displayTitle}</h1>
          {description && (
            <p className="text-muted-foreground text-base">{description}</p>
          )}
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {/* Issuer */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Issued By</h3>
          <UserName pubkey={event.pubkey} />
        </div>

        {/* Identifier */}
        {identifier && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Badge ID</h3>
            <code className="font-mono text-sm truncate" title={identifier}>
              {identifier}
            </code>
          </div>
        )}

        {/* Awards Count */}
        {awards && awards.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Times Awarded</h3>
            <span className="text-sm">
              {awards.length} award{awards.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Recipients Count */}
        {uniqueRecipients > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Recipients</h3>
            <span className="text-sm">
              {uniqueRecipients} user{uniqueRecipients !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Image Variants Section */}
      {(image || thumbnails.length > 0) && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Image Variants</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {image && (
              <ImageVariant
                url={image.url}
                dimensions={image.dimensions}
                label="Main Image"
              />
            )}
            {thumbnails.map((thumb, idx) => (
              <ImageVariant
                key={idx}
                url={thumb.url}
                dimensions={thumb.dimensions}
                label={`Thumbnail ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Award Address for Reference */}
      {identifier && (
        <div className="flex flex-col gap-2 p-4 bg-muted/30 rounded-lg">
          <h3 className="text-sm font-medium text-muted-foreground">
            Badge Address (for awarding)
          </h3>
          <code className="text-xs font-mono break-all">
            30009:{event.pubkey}:{identifier}
          </code>
        </div>
      )}
    </div>
  );
}
