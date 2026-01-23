import { useMemo } from "react";
import {
  getArticleTitle,
  getArticleSummary,
  getArticlePublished,
  getArticleImage,
} from "applesauce-common/helpers/article";
import { UserName } from "../UserName";
import { MediaEmbed } from "../MediaEmbed";
import { MarkdownContent } from "../MarkdownContent";
import { formatTimestamp } from "@/hooks/useLocale";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 30023 - Long-form Article
 * Displays full markdown content with metadata
 */
export function Kind30023DetailRenderer({ event }: { event: NostrEvent }) {
  const title = useMemo(() => getArticleTitle(event), [event]);
  const summary = useMemo(() => getArticleSummary(event), [event]);
  const published = useMemo(() => getArticlePublished(event), [event]);
  const imageUrl = useMemo(() => getArticleImage(event), [event]);

  // Get canonical URL from "r" tag to resolve relative URLs
  const canonicalUrl = useMemo(() => {
    const rTag = event.tags.find((t) => t[0] === "r");
    return rTag?.[1] || null;
  }, [event]);

  // Format published date using locale utility
  const publishedDate = published ? formatTimestamp(published, "long") : null;

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
      {/* Article Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        {/* Title */}
        {title && <h1 className="text-3xl font-bold">{title}</h1>}

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
          {publishedDate && (
            <>
              <span>•</span>
              <time>{publishedDate}</time>
            </>
          )}
        </div>
      </header>

      {/* Article Content - Markdown */}
      <MarkdownContent content={event.content} canonicalUrl={canonicalUrl} />
    </div>
  );
}
