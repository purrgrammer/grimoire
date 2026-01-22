import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { nip19 } from "nostr-tools";
import { UserName } from "./UserName";
import { EmbeddedEvent } from "./EmbeddedEvent";
import { MediaEmbed } from "./MediaEmbed";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { useCopy } from "@/hooks/useCopy";
import { useGrimoire } from "@/core/state";

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
        // note is just an event ID, wrap in EventPointer
        return (
          <EmbeddedEvent
            eventPointer={{ id: parsed.data }}
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
        // nevent includes full EventPointer with relay hints
        return (
          <EmbeddedEvent
            eventPointer={parsed.data}
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
 * Code block wrapper with copy button
 * Renders syntax-highlighted code or plain code with a copy button
 */
function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const { copy, copied } = useCopy();

  // Check if code is a single line (hide copy button for one-liners)
  const isSingleLine = !code.includes("\n");

  return (
    <div className="relative my-4">
      {language ? (
        <SyntaxHighlight code={code} language={language as any} />
      ) : (
        <pre
          className={`bg-muted p-4 border border-border rounded overflow-x-auto max-w-full ${isSingleLine ? "" : "pr-12"}`}
        >
          <code className="text-xs font-mono">{code}</code>
        </pre>
      )}
      {!isSingleLine && (
        <CodeCopyButton onCopy={() => copy(code)} copied={copied} />
      )}
    </div>
  );
}

export interface MarkdownContentProps {
  content: string;
  canonicalUrl?: string | null;
}

/**
 * Shared markdown renderer for Nostr content (articles, NIPs, etc.)
 * Handles nostr: mentions, syntax highlighting, media embeds, and relative URLs
 */
export function MarkdownContent({
  content,
  canonicalUrl = null,
}: MarkdownContentProps) {
  const { addWindow } = useGrimoire();

  // Helper to resolve relative URLs using canonical URL as base
  const resolveUrl = useMemo(
    () =>
      (url: string): string | null => {
        // If it's already absolute, return as-is
        if (url.match(/^https?:\/\//)) {
          return url;
        }

        // If we have a canonical URL, try to resolve relative URLs
        if (canonicalUrl) {
          try {
            return new URL(url, canonicalUrl).toString();
          } catch {
            console.warn("Failed to resolve relative URL:", url);
            return null;
          }
        }

        // No canonical URL and it's relative - can't resolve
        return null;
      },
    [canonicalUrl],
  );

  return (
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
          img: ({ src, alt }) => {
            if (!src) return null;

            const resolvedUrl = resolveUrl(src);
            if (!resolvedUrl) {
              // Can't resolve URL - show fallback
              return (
                <div className="my-4 p-4 border border-border rounded-lg bg-muted/10 text-sm text-muted-foreground">
                  <p>Media unavailable (relative URL without base)</p>
                  <p className="text-xs mt-1 break-all">{src}</p>
                </div>
              );
            }

            return (
              <MediaEmbed
                url={resolvedUrl}
                alt={alt}
                preset="preview"
                enableZoom
                className="my-4"
              />
            );
          },
          // Handle links: nostr mentions, NIP links, and regular URLs
          a: ({ href, children, ...props }) => {
            if (!href) return null;

            // Render nostr: mentions inline
            if (href.startsWith("nostr:")) {
              return <NostrMention href={href} />;
            }

            // Check if it's a relative NIP link (e.g., "./01.md" or "01.md")
            const isRelativeLink =
              !href.startsWith("http://") && !href.startsWith("https://");
            if (
              isRelativeLink &&
              (href.endsWith(".md") || href.includes(".md#"))
            ) {
              // Extract NIP number from various formats (numeric 1-3 digits or hex A0-FF)
              const nipMatch = href.match(/([0-9A-F]{1,3})\.md/i);
              if (nipMatch) {
                const nipNumber = nipMatch[1].toUpperCase();
                return (
                  <a
                    href={`#nip-${nipNumber}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addWindow(
                        "nip",
                        { number: nipNumber },
                        `NIP ${nipNumber}`,
                      );
                    }}
                    className="text-accent underline decoration-dotted cursor-crosshair hover:text-accent/80"
                  >
                    {children}
                  </a>
                );
              }
            }

            // Regular links with break-all for long URLs
            return (
              <a
                href={href}
                className="text-accent underline decoration-dotted break-all"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          // Don't render pre wrapper when we have a CodeBlock (it has its own container)
          pre: ({ children }) => <>{children}</>,
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
          code: ({ className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : null;
            const code = String(children).replace(/\n$/, "");

            // Inline code (no language)
            if (!language) {
              return (
                <code
                  className="bg-muted px-0.5 py-0.5 rounded text-xs font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            // Block code with syntax highlighting and copy button
            return <CodeBlock code={code} language={language} />;
          },
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
        {content.replace(/\\n/g, "\n")}
      </ReactMarkdown>
    </article>
  );
}
