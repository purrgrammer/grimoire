import { cn } from "@/lib/utils";
import { Hooks } from "applesauce-react";
import {
  getParsedContent,
  textNoteTransformers,
} from "applesauce-content/text";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Text } from "./RichText/Text";
import { Hashtag } from "./RichText/Hashtag";
import { Mention } from "./RichText/Mention";
import { Link } from "./RichText/Link";
import { Emoji } from "./RichText/Emoji";
import { Gallery } from "./RichText/Gallery";
import { Nip } from "./RichText/Nip";
import { Relay } from "./RichText/Relay";
import { EmojiOnlyContext } from "./RichText/emoji-only-context";
import { bareNostrMentions } from "@/lib/bare-mention-transformer";
import { nipReferences } from "@/lib/nip-transformer";
import { relayReferences } from "@/lib/relay-transformer";
import { getEmojiOnlyTier, type EmojiOnlyTier } from "@/lib/emoji-only";
import { useSettings } from "@/hooks/useSettings";
import type { NostrEvent } from "@/types/nostr";
import type { Root } from "applesauce-content/nast";
import type { ImetaEntry } from "@/lib/imeta";

/**
 * Props for custom media renderers
 */
export interface MediaRendererProps {
  /** The attachment's own URL — its identity, for labels and the Blossom link. */
  url: string;
  /**
   * What to actually render, when it differs. An encrypted attachment's `url`
   * serves CIPHERTEXT, so the caller resolves a decrypted object URL and passes
   * it here — while `url` stays the real one, so a chip still shows a filename
   * and still links to the blob rather than to a `blob:` handle.
   */
  src?: string;
  type: "image" | "video" | "audio";
  /** Image/video metadata from imeta tags (NIP-92) if available */
  imeta?: ImetaEntry;
}

// Context for passing the source event (for imeta lookup)
const EventContext = createContext<NostrEvent | null>(null);

export function useRichTextEvent() {
  return useContext(EventContext);
}

/** Transformer function type compatible with applesauce-content */
export type ContentTransformer = () => (tree: Root) => void;

const { useRenderedContent } = Hooks;

// Custom cache key for our extended transformers
const GrimoireContentSymbol = Symbol.for("grimoire-content");

// Default transformers including our custom NIP and relay transformers
export const defaultTransformers = [
  ...textNoteTransformers,
  // AFTER the built-ins, never before: it resolves ids with no whitespace
  // around them, and running it first would find them inside URLs too.
  bareNostrMentions,
  nipReferences,
  relayReferences,
];

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
  /**
   * Let an emoji-only body render larger (default: false).
   *
   * Opt-in per call site because most of them are one-line rows — compact
   * previews, reply cards, chat — whose fixed height a 48px glyph would break.
   * Only a post's own body should set it. The user's "Big emoji" appearance
   * setting still has the last word.
   */
  bigEmoji?: boolean;
}

// Default options
const defaultOptions: Required<RichTextOptions> = {
  showImages: true,
  showVideos: true,
  showAudio: true,
  showMedia: true,
  showEventEmbeds: true,
  bigEmoji: false,
};

// Context for passing options through RichText rendering
const OptionsContext = createContext<Required<RichTextOptions>>(defaultOptions);

export function useRichTextOptions() {
  return useContext(OptionsContext);
}

/**
 * Body type for each emoji-only tier, against the `text-sm` a post normally
 * uses. Tight leading, since a line of 48px glyphs at `leading-relaxed` leaves
 * a post that is mostly air.
 */
const emojiOnlyClasses: Record<EmojiOnlyTier, string> = {
  single: "text-5xl leading-tight",
  multi: "text-3xl leading-tight",
};

/**
 * Parser options for customizing content parsing
 */
export interface ParserOptions {
  /** Custom transformers to use instead of defaults */
  transformers?: ContentTransformer[];
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
// Using 'any' for node type since we extend with custom node types (like 'nip', 'relay')
const contentComponents: Record<string, React.ComponentType<{ node: any }>> = {
  text: Text,
  hashtag: Hashtag,
  mention: Mention,
  link: Link,
  emoji: Emoji,
  gallery: Gallery,
  nip: Nip,
  relay: Relay,
};

/**
 * RichText component that renders Nostr event content with rich formatting
 * Supports mentions, hashtags, links, emojis, galleries, NIP references, and relay links
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
  // Merge provided options with defaults
  const mergedOptions: Required<RichTextOptions> = {
    ...defaultOptions,
    ...options,
  };

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
      cacheKey,
    }),
    [transformers, cacheKey],
  );

  // Call hook unconditionally - it will handle undefined/null
  const trimmedEvent = event
    ? {
        ...event,
        content: event.content.trim(),
      }
    : undefined;

  const source = content
    ? ({
        content,
      } as NostrEvent)
    : trimmedEvent;

  const renderedContent = useRenderedContent(
    source,
    contentComponents,
    hookOptions,
  );

  // `children` is a caller's own prefix inside the body (a reply quote, a
  // label), so a body that has one is not emoji-only whatever its content.
  const { settings } = useSettings();
  const bigEmoji =
    mergedOptions.bigEmoji &&
    !children &&
    (settings?.appearance?.bigEmoji ?? true);
  // Same arguments as the hook above, so for a real event this reads the tree
  // it just cached instead of parsing the content a second time.
  const parsedTier =
    bigEmoji && source
      ? getEmojiOnlyTier(
          getParsedContent(source, undefined, transformers, cacheKey),
        )
      : null;

  // A custom emoji whose image failed renders as its shortcode, which is text:
  // the body is no longer emoji-only. Keyed by content, so the next event
  // rendered by this instance starts clean.
  const [imageFailedFor, setImageFailedFor] = useState<string | null>(null);
  const sourceContent = source?.content;
  const emojiOnlyTier = imageFailedFor === sourceContent ? null : parsedTier;
  const onImageError = useCallback(
    () => setImageFailedFor(sourceContent ?? null),
    [sourceContent],
  );
  const emojiOnly = useMemo(
    () => ({ tier: emojiOnlyTier, onImageError }),
    [emojiOnlyTier, onImageError],
  );

  return (
    <DepthContext.Provider value={depth}>
      <OptionsContext.Provider value={mergedOptions}>
        <EventContext.Provider value={event ?? null}>
          <div
            dir="auto"
            className={cn(
              // pre-wrap keeps the alignment of ASCII art and indented text;
              // one-line previews override it with `whitespace-normal`
              "break-words whitespace-pre-wrap",
              className,
              // After className: tailwind-merge drops a `leading-*` that comes
              // before a font-size class, so a caller's `text-sm` silently
              // reset this to the size's tight default. A caller's own
              // `leading-*` still wins.
              !/\bleading-/.test(className ?? "") && "leading-relaxed",
              // Last, so it overrides the caller's font size and leading.
              emojiOnlyTier && emojiOnlyClasses[emojiOnlyTier],
            )}
            data-emoji-only={emojiOnlyTier ?? undefined}
          >
            {children}
            <EmojiOnlyContext.Provider value={emojiOnly}>
              {renderedContent}
            </EmojiOnlyContext.Provider>
          </div>
        </EventContext.Provider>
      </OptionsContext.Provider>
    </DepthContext.Provider>
  );
}
