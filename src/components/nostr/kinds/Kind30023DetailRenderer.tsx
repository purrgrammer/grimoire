import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { nip19 } from "nostr-tools";
import {
  getArticleTitle,
  getArticleSummary,
  getArticlePublished,
} from "applesauce-core/helpers/article";
import { UserName } from "../UserName";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { MediaEmbed } from "../MediaEmbed";
import { useGrimoire } from "@/core/state";
import type { NostrEvent } from "@/types/nostr";

/**
 * Component to render nostr: mentions inline
 */
function NostrMention({ href }: { href: string }) {
  const { addWindow } = useGrimoire();

  try {
    // Remove nostr: prefix and any trailing characters
    const cleanHref = href.replace(/^nostr:/, "").trim();

    // If it doesn't look like a nostr identifier, just return the href as-is
    if (!cleanHref.match(/^(npub|nprofile|note|nevent|naddr)/)) {
      return (
        <a
          href={href}
          className="text-accent underline decoration-dotted break-all"
          target="_blank"
          rel="noopener noreferrer"
        >
          {href}
        </a>
      );
    }

    const parsed = nip19.decode(cleanHref);

    switch (parsed.type) {
      case "npub":
        return (
          <span className="inline-flex items-center">
            <UserName
              pubkey={parsed.data}
              className="text-accent font-semibold"
            />
          </span>
        );
      case "nprofile":
        return (
          <span className="inline-flex items-center">
            <UserName
              pubkey={parsed.data.pubkey}
              className="text-accent font-semibold"
            />
          </span>
        );
      case "note":
        return (
          <EmbeddedEvent
            eventId={parsed.data}
            onOpen={(id) => {
              addWindow(
                "open",
                { id: id as string },
                `Event ${(id as string).slice(0, 8)}...`,
              );
            }}
          />
        );
      case "nevent":
        return (
          <EmbeddedEvent
            eventId={parsed.data.id}
            onOpen={(id) => {
              addWindow(
                "open",
                { id: id as string },
                `Event ${(id as string).slice(0, 8)}...`,
              );
            }}
          />
        );
      case "naddr":
        return (
          <EmbeddedEvent
            addressPointer={parsed.data}
            onOpen={(pointer) => {
              addWindow(
                "open",
                pointer,
                `${parsed.data.kind}:${parsed.data.identifier.slice(0, 8)}...`,
              );
            }}
          />
        );
      default:
        return <span className="text-muted-foreground">{cleanHref}</span>;
    }
  } catch (error) {
    // If parsing fails, just render as a regular link
    console.error("Failed to parse nostr link:", href, error);
    return (
      <a
        href={href}
        className="text-accent underline decoration-dotted break-all"
        target="_blank"
        rel="noopener noreferrer"
      >
        {href}
      </a>
    );
  }
}

/**
 * Detail renderer for Kind 30023 - Long-form Article
 * Displays full markdown content with metadata
 */
export function Kind30023DetailRenderer({ event }: { event: NostrEvent }) {
  const title = useMemo(() => getArticleTitle(event), [event]);
  const summary = useMemo(() => getArticleSummary(event), [event]);
  const published = useMemo(() => getArticlePublished(event), [event]);

  // Format published date
  const publishedDate = published
    ? new Date(published * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Article Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        {/* Title */}
        {title && <h1 className="text-3xl font-bold">{title}</h1>}

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
      <article className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkNostrMentions]}
          skipHtml
          urlTransform={(url) => {
            if (url.startsWith("nostr:")) return url;
            return defaultUrlTransform(url);
          }}
          components={{
            // Enable images with zoom
            img: ({ src, alt }) =>
              src ? (
                <MediaEmbed
                  url={src}
                  alt={alt}
                  preset="preview"
                  enableZoom
                  className="my-4"
                />
              ) : null,
            // Handle nostr: links
            a: ({ href, children, ...props }) => {
              if (!href) return null;

              // Render nostr: mentions inline
              if (href.startsWith("nostr:")) {
                return <NostrMention href={href} />;
              }

              // Regular links
              return (
                <a
                  href={href}
                  className="text-accent underline decoration-dotted"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              );
            },
            // Make pre elements display inline
            pre: ({ children, ...props }) => (
              <span className="inline" {...props}>
                {children}
              </span>
            ),
            // Style adjustments for dark theme
            h1: ({ ...props }) => (
              <h1 className="text-2xl font-bold mt-8 mb-4" {...props} />
            ),
            h2: ({ ...props }) => (
              <h2 className="text-xl font-bold mt-6 mb-3" {...props} />
            ),
            h3: ({ ...props }) => (
              <h3 className="text-lg font-bold mt-4 mb-2" {...props} />
            ),
            p: ({ ...props }) => (
              <p className="text-sm leading-relaxed mb-4" {...props} />
            ),
            code: ({ ...props }: any) => (
              <code
                className="bg-muted px-0.5 py-0.5 rounded text-xs font-mono"
                {...props}
              />
            ),
            blockquote: ({ ...props }) => (
              <blockquote
                className="border-l-4 border-muted pl-4 italic text-muted-foreground my-4"
                {...props}
              />
            ),
            ul: ({ ...props }) => (
              <ul
                className="text-sm list-disc list-inside my-4 space-y-2"
                {...props}
              />
            ),
            ol: ({ ...props }) => (
              <ol
                className="text-sm list-decimal list-inside my-4 space-y-2"
                {...props}
              />
            ),
            hr: () => <hr className="my-4" />,
          }}
        >
          {event.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
