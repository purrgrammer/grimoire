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

interface RichTextProps {
  event?: NostrEvent;
  content?: string;
  className?: string;
  depth?: number;
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
}: RichTextProps) {
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
        <div className={cn("leading-relaxed break-words", className)}>
          {renderedContent}
        </div>
      </DepthContext.Provider>
    );
  }

  return null;
}
