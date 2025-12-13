import { cn } from "@/lib/utils";
import { Hooks } from "applesauce-react";
import { createContext, useContext } from "react";
import { Text } from "./RichText/Text";
import { Hashtag } from "./RichText/Hashtag";
import { Mention } from "./RichText/Mention";
import { Link } from "./RichText/Link";
import { Emoji } from "./RichText/Emoji";
import { Gallery } from "./RichText/Gallery";
import type { NostrEvent } from "@/types/nostr";

const { useRenderedContent } = Hooks;

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

interface RichTextProps {
  event?: NostrEvent;
  content?: string;
  className?: string;
  depth?: number;
  options?: RichTextOptions;
}

// Content node component types for rendering
const contentComponents = {
  text: Text,
  hashtag: Hashtag,
  mention: Mention,
  link: Link,
  emoji: Emoji,
  gallery: Gallery,
};

/**
 * RichText component that renders Nostr event content with rich formatting
 * Supports mentions, hashtags, links, emojis, and galleries
 * Can also render plain text without requiring a full event
 */
export function RichText({
  event,
  content,
  className = "",
  depth = 1,
  options = {},
}: RichTextProps) {
  // Merge provided options with defaults
  const mergedOptions: Required<RichTextOptions> = {
    ...defaultOptions,
    ...options,
  };

  // Call hook unconditionally - it will handle undefined/null
  const trimmedEvent = event
    ? {
        ...event,
        content: event.content.trim(),
      }
    : undefined;
  const renderedContent = useRenderedContent(
    trimmedEvent as NostrEvent,
    contentComponents,
  );

  // If plain content is provided, just render it
  if (content && !event) {
    const lines = content.trim().split("\n");
    return (
      <div className={cn("leading-relaxed break-words", className)}>
        {lines.map((line, idx) => (
          <div key={idx} dir="auto">
            {line || "\u00A0"}
          </div>
        ))}
      </div>
    );
  }

  // Render event content with rich formatting
  if (event) {
    return (
      <DepthContext.Provider value={depth}>
        <OptionsContext.Provider value={mergedOptions}>
          <div className={cn("leading-relaxed break-words", className)}>
            {renderedContent}
          </div>
        </OptionsContext.Provider>
      </DepthContext.Provider>
    );
  }

  return null;
}
