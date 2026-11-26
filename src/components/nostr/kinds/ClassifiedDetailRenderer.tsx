import { Calendar, MapPin, RefreshCw } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { formatTimestamp } from "@/hooks/useLocale";
import { parseClassified } from "@/lib/nip99-helpers";
import type { NostrEvent } from "@/types/nostr";
import { Label } from "@/components/ui/label";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import {
  ClassifiedImageView,
  ClassifiedPrice,
  ClassifiedStateBadges,
} from "./ClassifiedRenderer";

/**
 * Detail view for NIP-99 kinds 30402 (listing) and 30403 (draft or
 * inactive listing). See ClassifiedRenderer.tsx for what is and is not
 * claimed. The body is markdown rendered by MarkdownContent, which skips raw
 * HTML and only follows http(s) and nostr: links.
 */
export function ClassifiedDetailRenderer({ event }: { event: NostrEvent }) {
  const { locale } = useGrimoire();
  const classified = parseClassified(event);
  const { title, summary, location, geohash, publishedAt, categories, images } =
    classified;
  const [cover, ...rest] = images;
  const content = event.content.trim();

  // A replaceable event's created_at is when this version was signed; only
  // call it an update when it differs from the declared first publication.
  const updatedAt =
    publishedAt && event.created_at > publishedAt
      ? event.created_at
      : undefined;

  return (
    <article
      dir="auto"
      className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 p-4 sm:p-6"
    >
      <header className="flex min-w-0 flex-col gap-3 border-b border-border pb-6">
        <ClassifiedStateBadges classified={classified} className="flex-wrap" />

        <h1
          className={
            title
              ? "text-2xl font-bold break-words sm:text-3xl"
              : "text-2xl italic text-muted-foreground"
          }
        >
          {title || "Untitled listing"}
        </h1>

        <ClassifiedPrice
          classified={classified}
          className="flex-wrap text-xl sm:text-2xl"
          frequencyClassName="text-base"
        />

        {summary && (
          <p className="text-base text-muted-foreground break-words">
            {summary}
          </p>
        )}

        <dl className="flex min-w-0 flex-col gap-1.5 text-sm text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <dt className="shrink-0">Listed by</dt>
            <dd className="min-w-0 truncate">
              <UserName pubkey={event.pubkey} className="font-semibold" />
            </dd>
          </div>
          {(location || geohash) && (
            <div className="flex min-w-0 items-center gap-2">
              <dt className="sr-only">Location</dt>
              <MapPin className="size-4 shrink-0" aria-hidden />
              <dd className="min-w-0 break-words">
                {location}
                {geohash && (
                  <span
                    className="ml-2 font-mono text-xs"
                    title="Geohash from the listing's g tag"
                  >
                    {geohash}
                  </span>
                )}
              </dd>
            </div>
          )}
          {publishedAt && (
            <div className="flex items-center gap-2">
              <dt className="sr-only">First published</dt>
              <Calendar className="size-4 shrink-0" aria-hidden />
              <dd>
                <time
                  dateTime={new Date(publishedAt * 1000).toISOString()}
                  title={formatTimestamp(
                    publishedAt,
                    "absolute",
                    locale.locale,
                  )}
                >
                  Published{" "}
                  {formatTimestamp(publishedAt, "long", locale.locale)}
                </time>
              </dd>
            </div>
          )}
          {updatedAt && (
            <div className="flex items-center gap-2">
              <dt className="sr-only">This version</dt>
              <RefreshCw className="size-4 shrink-0" aria-hidden />
              <dd>
                <time
                  dateTime={new Date(updatedAt * 1000).toISOString()}
                  title={formatTimestamp(updatedAt, "absolute", locale.locale)}
                >
                  Updated {formatTimestamp(updatedAt, "long", locale.locale)}
                </time>
              </dd>
            </div>
          )}
        </dl>
      </header>

      {cover && (
        <section aria-label="Images" className="flex min-w-0 flex-col gap-2">
          <ClassifiedImageView
            image={cover}
            alt={title || "Listing image"}
            preset="preview"
            className="w-full overflow-hidden rounded-lg"
          />
          {rest.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {rest.map((image, i) => (
                <ClassifiedImageView
                  key={image.url}
                  image={image}
                  alt={`${title || "Listing"} image ${i + 2}`}
                  preset="grid"
                />
              ))}
            </div>
          )}
        </section>
      )}

      {content ? (
        <MarkdownContent content={event.content} sourceEvent={event} />
      ) : (
        <p className="text-sm italic text-muted-foreground">
          This listing has no description.
        </p>
      )}

      {categories.length > 0 && (
        <footer className="flex min-w-0 flex-wrap gap-1.5 border-t border-border pt-4">
          {categories.map((category) => (
            <Label key={category} size="md" className="max-w-full">
              {category}
            </Label>
          ))}
        </footer>
      )}

      {classified.identifier && (
        <p
          className="min-w-0 break-all text-xs text-muted-foreground"
          title="The d tag: with the author and kind, it names this listing across edits"
        >
          Listing identifier{" "}
          <span className="font-mono">{classified.identifier}</span>
        </p>
      )}
    </article>
  );
}
