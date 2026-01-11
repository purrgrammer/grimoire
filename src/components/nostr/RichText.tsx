import { cn } from "@/lib/utils";
import { Hooks } from "applesauce-react";
import { textNoteTransformers } from "applesauce-content/text";
import { createContext, useContext, useState, useMemo } from "react";
import { Text } from "./RichText/Text";
import { Hashtag } from "./RichText/Hashtag";
import { Mention } from "./RichText/Mention";
import { Link } from "./RichText/Link";
import { Emoji } from "./RichText/Emoji";
import { Gallery } from "./RichText/Gallery";
import { Nip } from "./RichText/Nip";
import { nipReferences } from "@/lib/nip-transformer";
import type { NostrEvent } from "@/types/nostr";
import type { Root } from "applesauce-content/nast";

/** Transformer function type compatible with applesauce-content */
type ContentTransformer = () => (tree: Root) => void;

const { useRenderedContent } = Hooks;

// Custom cache key for our extended transformers
const GrimoireContentSymbol = Symbol.for("grimoire-content");

// Default transformers including our custom NIP transformer
const defaultTransformers = [...textNoteTransformers, nipReferences];

// Context for passing depth through RichText rendering
const DepthContext = createContext<number>(1);

export function useDepth() {
  return useContext(DepthContext);
}

/**
 * Configuration options for RichText rendering behavior
 */
export interface RichTextOptions {
  /** Show images inline (default: true) */
  showImages?: boolean;
  /** Show videos inline (default: true) */
  showVideos?: boolean;
  /** Show audio players inline (default: true) */
  showAudio?: boolean;
  /** Convenience flag to disable all media at once (default: true) */
  showMedia?: boolean;
  /** Show event embeds for note/nevent/naddr mentions (default: true) */
  showEventEmbeds?: boolean;
}

// Default options
const defaultOptions: Required<RichTextOptions> = {
  showImages: true,
  showVideos: true,
  showAudio: true,
  showMedia: true,
  showEventEmbeds: true,
};

// Context for passing options through RichText rendering
const OptionsContext = createContext<Required<RichTextOptions>>(defaultOptions);

export function useRichTextOptions() {
  return useContext(OptionsContext);
}

/**
 * Parser options for customizing content parsing
 */
export interface ParserOptions {
  /** Custom transformers to use instead of defaults */
  transformers?: ContentTransformer[];
  /** Maximum content length before truncation (characters) */
  maxLength?: number;
  /** Custom cache key (pass null to disable caching) */
  cacheKey?: symbol | null;
}

interface RichTextProps {
  event?: NostrEvent;
  content?: string;
  className?: string;
  depth?: number;
  options?: RichTextOptions;
  /** Parser options for customizing content parsing */
  parserOptions?: ParserOptions;
  children?: React.ReactNode;
}

// Content node component types for rendering
// Using 'any' for node type since we extend with custom node types (like 'nip')
const contentComponents: Record<string, React.ComponentType<{ node: any }>> = {
  text: Text,
  hashtag: Hashtag,
  mention: Mention,
  link: Link,
  emoji: Emoji,
  gallery: Gallery,
  nip: Nip,
};

/**
 * RichText component that renders Nostr event content with rich formatting
 * Supports mentions, hashtags, links, emojis, galleries, and NIP references
 * Can also render plain text without requiring a full event
 */
export function RichText({
  event,
  content,
  className = "",
  depth = 1,
  options = {},
  parserOptions = {},
  children,
}: RichTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Merge provided options with defaults
  const mergedOptions: Required<RichTextOptions> = {
    ...defaultOptions,
    ...options,
  };

  // Get content string for length checking
  const contentString = content ?? event?.content ?? "";

  // Determine if content might need truncation
  const maxLength = parserOptions.maxLength;
  const mightBeTruncated = maxLength && contentString.length > maxLength;

  // Use effective maxLength based on expansion state
  const effectiveMaxLength =
    isExpanded || !mightBeTruncated ? undefined : maxLength;

  // Prepare transformers - use provided or defaults
  const transformers = parserOptions.transformers ?? defaultTransformers;

  // Prepare cache key - use provided, or default, or null to disable
  const cacheKey =
    parserOptions.cacheKey === null
      ? null
      : (parserOptions.cacheKey ?? GrimoireContentSymbol);

  // Memoize hook options to prevent unnecessary re-renders
  const hookOptions = useMemo(
    () => ({
      transformers,
      maxLength: effectiveMaxLength,
      cacheKey,
    }),
    [transformers, effectiveMaxLength, cacheKey],
  );

  // Call hook unconditionally - it will handle undefined/null
  const trimmedEvent = event
    ? {
        ...event,
        content: event.content.trim(),
      }
    : undefined;

  const renderedContent = useRenderedContent(
    content
      ? ({
          content,
        } as NostrEvent)
      : trimmedEvent,
    contentComponents,
    hookOptions,
  );

  // Show expand button only when content is truncated and not expanded
  const showExpandButton = mightBeTruncated && !isExpanded;

  return (
    <DepthContext.Provider value={depth}>
      <OptionsContext.Provider value={mergedOptions}>
        <div
          dir="auto"
          className={cn("leading-relaxed break-words", className)}
        >
          {children}
          {renderedContent}
          {showExpandButton && (
            <button
              onClick={() => setIsExpanded(true)}
              className="text-primary hover:underline text-sm mt-1 block"
            >
              Show more
            </button>
          )}
        </div>
      </OptionsContext.Provider>
    </DepthContext.Provider>
  );
}
