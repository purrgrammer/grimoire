import { useMemo } from "react";
import { getTagValue } from "applesauce-core/helpers";
import { UserName } from "../UserName";
import { MediaEmbed } from "../MediaEmbed";
import { AsciidocContent } from "../AsciidocContent";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 30818 - Wiki Article (NIP-54)
 * Displays full Asciidoc content with metadata
 * Note: getTagValue caches internally, no useMemo needed
 */
export function WikiDetailRenderer({ event }: { event: NostrEvent }) {
  // Get title from "title" tag, fallback to "d" tag (subject identifier)
  const title = getTagValue(event, "title") || getTagValue(event, "d");
  const summary = getTagValue(event, "summary");
  const imageUrl = getTagValue(event, "image");

  // Get canonical URL from "r" tag to resolve relative URLs
  const canonicalUrl = useMemo(() => {
    const rTag = event.tags.find((t) => t[0] === "r");
    return rTag?.[1] || null;
  }, [event]);

  // Format created date (wiki articles use created_at timestamp)
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  // Resolve article image URL
  const resolvedImageUrl = useMemo(() => {
    if (!imageUrl) return null;
    if (imageUrl.match(/^https?:\/\//)) return imageUrl;
    if (canonicalUrl) {
      try {
        return new URL(imageUrl, canonicalUrl).toString();
      } catch {
        return null;
      }
    }
    return null;
  }, [imageUrl, canonicalUrl]);

  return (
    <div dir="auto" className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Wiki Article Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        {/* Title */}
        {title && <h1 className="text-3xl font-bold">{title}</h1>}
        {!title && (
          <h1 className="text-3xl font-bold text-muted-foreground italic">
            (Untitled wiki article)
          </h1>
        )}

        {/* Featured Image */}
        {resolvedImageUrl && (
          <MediaEmbed
            url={resolvedImageUrl}
            preset="preview"
            enableZoom
            className="w-full rounded-lg overflow-hidden"
          />
        )}

        {/* Summary */}
        {summary && <p className="text-lg text-muted-foreground">{summary}</p>}

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>
      </header>

      {/* Wiki Article Content - Asciidoc */}
      <AsciidocContent content={event.content} canonicalUrl={canonicalUrl} />
    </div>
  );
}
