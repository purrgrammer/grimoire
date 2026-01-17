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
 * Detail renderer for Kind 30009 - Badge (NIP-58)
 * Shows badge information including all image variants
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
    </div>
  );
}
