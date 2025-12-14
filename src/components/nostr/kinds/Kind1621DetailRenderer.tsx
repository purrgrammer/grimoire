import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { nip19 } from "nostr-tools";
import { Tag, GitBranch } from "lucide-react";
import { UserName } from "../UserName";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { MediaEmbed } from "../MediaEmbed";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import type { NostrEvent } from "@/types/nostr";
import {
  getIssueTitle,
  getIssueLabels,
  getIssueRepositoryAddress,
} from "@/lib/nip34-helpers";
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";

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
 * Detail renderer for Kind 1621 - Issue
 * Displays full issue content with markdown rendering
 */
export function Kind1621DetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const title = useMemo(() => getIssueTitle(event), [event]);
  const labels = useMemo(() => getIssueLabels(event), [event]);
  const repoAddress = useMemo(() => getIssueRepositoryAddress(event), [event]);

  // Parse repository address
  const repoPointer = useMemo(() => {
    if (!repoAddress) return null;
    try {
      const [kindStr, pubkey, identifier] = repoAddress.split(":");
      return {
        kind: parseInt(kindStr),
        pubkey,
        identifier,
      };
    } catch {
      return null;
    }
  }, [repoAddress]);

  // Fetch repository event
  const repoEvent = useNostrEvent(repoPointer || undefined);

  // Get repository display name
  const repoName = repoEvent
    ? getRepositoryName(repoEvent) ||
      getRepositoryIdentifier(repoEvent) ||
      "Repository"
    : repoPointer?.identifier || "Unknown Repository";

  // Format created date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  const handleRepoClick = () => {
    if (!repoPointer || !repoEvent) return;
    addWindow("open", { pointer: repoPointer }, `Repository: ${repoName}`);
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Issue Header */}
      <header className="flex flex-col gap-4 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-3xl font-bold">{title || "Untitled Issue"}</h1>

        {/* Repository Link */}
        {repoAddress && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Repository:</span>
            <button
              onClick={repoEvent ? handleRepoClick : undefined}
              disabled={!repoEvent}
              className={`flex items-center gap-2 font-mono ${
                repoEvent
                  ? "text-muted-foreground underline decoration-dotted cursor-crosshair hover:text-primary"
                  : "text-muted-foreground cursor-not-allowed"
              }`}
            >
              <GitBranch className="size-4" />
              {repoName}
            </button>
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="size-3 text-muted-foreground" />
            {labels.map((label, idx) => (
              <span
                key={idx}
                className="px-3 py-1 border border-muted border-dotted text-muted-foreground text-xs"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Issue Body - Markdown */}
      {event.content ? (
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
      ) : (
        <p className="text-sm text-muted-foreground italic">
          (No description provided)
        </p>
      )}
    </div>
  );
}
