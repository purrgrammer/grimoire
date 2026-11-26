import { MapPin } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";
import {
  formatClassifiedPrice,
  formatFrequency,
  parseClassified,
  type Classified,
  type ClassifiedImage,
} from "@/lib/nip99-helpers";
import { Label } from "@/components/ui/label";
import { MediaEmbed } from "../MediaEmbed";
import { CompactMediaRenderer } from "../CompactMediaRenderer";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";

/**
 * NIP-99 classified listing (kind 30402) and draft/inactive listing (30403).
 *
 * Everything shown comes from the event's own tags: no exchange rates, no
 * availability beyond the author's `status` tag, nothing fetched. A listing
 * without a status tag shows no status at all — absence is not "active".
 * All tag values are rendered as React text; the body is never shown here
 * (the detail view renders it as markdown, with raw HTML skipped).
 */

/**
 * The state the listing itself declares. A 30403 says "draft or inactive" and
 * no more, so that is what the badge says.
 */
export function ClassifiedStateBadges({
  classified,
  className,
}: {
  classified: Classified;
  className?: string;
}) {
  const { isDraft, status } = classified;
  if (!isDraft && !status) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {isDraft && (
        <Label
          className="shrink-0 border-amber-500/60 text-amber-600 dark:text-amber-400"
          title="Kind 30403: saved as a draft, or marked inactive by its author"
        >
          Draft or inactive
        </Label>
      )}
      {status?.type === "sold" && (
        <Label
          className="shrink-0 border-destructive/60 text-destructive"
          title='The author tagged this listing "sold"'
        >
          Sold
        </Label>
      )}
      {status?.type === "active" && (
        <Label
          className="shrink-0"
          title='The author tagged this listing "active"'
        >
          Active
        </Label>
      )}
      {status?.type === "other" && (
        <Label className="min-w-0" title="Status as written by the author">
          {status.value}
        </Label>
      )}
    </span>
  );
}

/** The price as listed, in its own currency, with its frequency. */
export function ClassifiedPrice({
  classified,
  className,
  frequencyClassName,
}: {
  classified: Classified;
  className?: string;
  frequencyClassName?: string;
}) {
  const { locale } = useGrimoire();
  const { price, status } = classified;
  if (!price) return null;
  const text = formatClassifiedPrice(price, locale.locale);
  const malformed = price.amount === undefined;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-baseline gap-1",
        status?.type === "sold" && "line-through decoration-1",
        className,
      )}
      title={
        malformed
          ? "Price as written: the amount is not a number"
          : [price.raw, price.currency, price.frequency]
              .filter(Boolean)
              .join(" ")
      }
    >
      <span className="truncate font-semibold tabular-nums text-foreground">
        {text}
      </span>
      {price.frequency && (
        <span
          className={cn(
            "truncate text-muted-foreground font-normal",
            frequencyClassName,
          )}
        >
          {formatFrequency(price.frequency)}
        </span>
      )}
    </span>
  );
}

/**
 * One listing image. Honours the "load media" setting: with it off, the image
 * stays a click-to-load link instead of a request to the seller's host.
 * A host that fails to serve it gets MediaEmbed's own error/retry state.
 */
export function ClassifiedImageView({
  image,
  alt,
  preset,
  className,
}: {
  image: ClassifiedImage;
  alt: string;
  preset: "thumbnail" | "preview" | "grid";
  className?: string;
}) {
  const { settings } = useSettings();
  const loadMedia = settings?.appearance?.loadMedia ?? true;
  if (!loadMedia) {
    return (
      <CompactMediaRenderer url={image.url} src={image.url} type="image" />
    );
  }
  return (
    <MediaEmbed
      url={image.url}
      type="image"
      alt={alt}
      preset={preset}
      enableZoom
      className={className}
    />
  );
}

/** Feed card for kinds 30402 and 30403. */
export function ClassifiedRenderer({ event }: BaseEventProps) {
  const classified = parseClassified(event);
  const { title, summary, location, categories, images, isDraft } = classified;
  const cover = images[0];

  return (
    <BaseEventContainer event={event}>
      <div
        dir="auto"
        className={cn("flex min-w-0 gap-3", isDraft && "opacity-80")}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <ClassifiedStateBadges classified={classified} />

          <ClickableEventTitle
            event={event}
            className={cn(
              "text-base font-semibold text-foreground break-words line-clamp-2",
              !title && "italic text-muted-foreground font-normal",
            )}
          >
            {title || "Untitled listing"}
          </ClickableEventTitle>

          <ClassifiedPrice classified={classified} className="text-base" />

          {summary && (
            <p className="text-sm text-muted-foreground line-clamp-2 break-words">
              {summary}
            </p>
          )}

          {(location || categories.length > 0) && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {location && (
                <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{location}</span>
                </span>
              )}
              {categories.slice(0, 6).map((category) => (
                <Label key={category} className="max-w-[12rem]">
                  {category}
                </Label>
              ))}
            </div>
          )}
        </div>

        {cover && (
          <div className="size-20 shrink-0 overflow-hidden rounded-md sm:size-24">
            <ClassifiedImageView
              image={cover}
              alt={title || "Listing image"}
              preset="grid"
              className="size-full"
            />
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
