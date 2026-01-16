import { useMemo } from "react";
import Asciidoctor from "@asciidoctor/core";
import { useGrimoire } from "@/core/state";

export interface AsciidocContentProps {
  content: string;
  canonicalUrl?: string | null; // Reserved for future use (image URL resolution)
}

/**
 * Normalize wiki subject according to NIP-54 rules:
 * - Convert to lowercase
 * - Replace whitespace with hyphens
 * - Remove punctuation/symbols
 * - Collapse multiple hyphens
 * - Strip leading/trailing hyphens
 */
function normalizeWikiSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/[^\w\u0080-\uFFFF-]/g, "") // remove non-word chars except UTF-8 and hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-+|-+$/g, ""); // strip leading/trailing hyphens
}

/**
 * Process wikilinks [[...]] and nostr: links in HTML
 * Replaces [[target|display]] wikilinks with clickable links
 * Replaces nostr: links with embedded components or clickable links
 */
function processLinks(html: string): string {
  // Process wikilinks [[target|display]] or [[target]]
  html = html.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target, display) => {
      const normalized = normalizeWikiSubject(target);
      const displayText = display || target;
      return `<a href="#wiki-${normalized}" class="wiki-link" data-wiki="${normalized}">${displayText}</a>`;
    },
  );

  // Process nostr: links (already in <a> tags from asciidoctor)
  // For now, render them as plain links (TODO: parse and render as mentions)
  html = html.replace(
    /<a[^>]*href="nostr:([^"]+)"[^>]*>([^<]+)<\/a>/g,
    (_match, nostrId, linkText) => {
      // Render as clickable link with nostr-mention class
      return `<span class="nostr-mention" data-nostr-id="${nostrId}">${linkText}</span>`;
    },
  );

  return html;
}

/**
 * Shared Asciidoc renderer for Nostr wiki content (kind 30818)
 * Handles wikilinks [[...]], nostr: mentions, and media embeds
 */
export function AsciidocContent({
  content,
  canonicalUrl: _canonicalUrl = null, // Reserved for future use
}: AsciidocContentProps) {
  const { addWindow } = useGrimoire();

  // Initialize asciidoctor processor
  const asciidoctor = useMemo(() => Asciidoctor(), []);

  // Convert Asciidoc to HTML
  const html = useMemo(() => {
    try {
      const rawHtml = asciidoctor.convert(content, {
        safe: "safe",
        attributes: {
          showtitle: true,
          sectanchors: true,
          icons: "font",
        },
      }) as string;

      // Process wikilinks and nostr links
      return processLinks(rawHtml);
    } catch (error) {
      console.error("Failed to convert Asciidoc:", error);
      return `<div class="text-destructive text-sm">Failed to render wiki content: ${error instanceof Error ? error.message : "Unknown error"}</div>`;
    }
  }, [content, asciidoctor]);

  // Handle clicks on wiki links and nostr mentions
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Handle wiki links
    if (target.classList.contains("wiki-link")) {
      e.preventDefault();
      const subject = target.getAttribute("data-wiki");
      if (subject) {
        addWindow("wiki", { subject }, `Wiki: ${subject}`);
      }
      return;
    }

    // Handle nostr mentions
    // TODO: Parse nostr: links and open appropriate windows
    if (target.classList.contains("nostr-mention")) {
      e.preventDefault();
      const nostrId = target.getAttribute("data-nostr-id");
      if (nostrId) {
        console.log("Nostr mention clicked:", nostrId);
        // For now, just log - we can implement parsing later
      }
    }
  };

  return (
    <article
      className="prose prose-invert prose-sm max-w-none asciidoc-content"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
