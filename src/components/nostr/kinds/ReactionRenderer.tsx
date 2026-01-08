import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { Heart, ThumbsUp, ThumbsDown, Flame, Smile } from "lucide-react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useMemo } from "react";
import { NostrEvent } from "@/types/nostr";
import { KindRenderer } from "./index";
import { EventCardSkeleton } from "@/components/ui/skeleton";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";

/**
 * Renderer for Kind 7 - Reactions
 * Displays emoji/reaction with the event being reacted to
 * Supports both e tags (event ID) and a tags (address/replaceable events)
 */
export function Kind7Renderer({ event }: BaseEventProps) {
  // Get the reaction content (usually an emoji)
  const reaction = event.content || "❤️";

  // NIP-30: Custom emoji support
  // emoji tags format: ["emoji", "shortcode", "image_url"]
  const emojiTags = event.tags.filter((tag) => tag[0] === "emoji");
  const customEmojis = useMemo(() => {
    const map: Record<string, string> = {};
    emojiTags.forEach((tag) => {
      if (tag[1] && tag[2]) {
        map[tag[1]] = tag[2]; // shortcode -> image_url
      }
    });
    return map;
  }, [emojiTags]);

  // Parse reaction content to detect custom emoji shortcodes
  // Format: :shortcode: in the content
  const parsedReaction = useMemo(() => {
    const match = reaction.match(/^:([a-zA-Z0-9_]+):$/);
    if (match && customEmojis[match[1]]) {
      return {
        type: "custom" as const,
        shortcode: match[1],
        url: customEmojis[match[1]],
      };
    }
    return {
      type: "unicode" as const,
      emoji: reaction,
    };
  }, [reaction, customEmojis]);

  // Get the event being reacted to (e tag for regular events)
  const eTag = event.tags.find((tag) => tag[0] === "e");
  const reactedEventId = eTag?.[1];
  const reactedRelay = eTag?.[2]; // Optional relay hint

  // Get the address being reacted to (a tag for replaceable events)
  const aTag = event.tags.find((tag) => tag[0] === "a");
  const reactedAddress = aTag?.[1]; // Format: kind:pubkey:d-tag

  // Parse a tag coordinate using applesauce helper (renamed in v5)
  const addressPointer = reactedAddress
    ? parseReplaceableAddress(reactedAddress)
    : null;

  // Create event pointer for fetching
  const eventPointer = useMemo(() => {
    if (reactedEventId) {
      return {
        id: reactedEventId,
        relays: reactedRelay ? [reactedRelay] : undefined,
      };
    }
    if (addressPointer) {
      return {
        kind: addressPointer.kind,
        pubkey: addressPointer.pubkey,
        identifier: addressPointer.identifier || "",
        relays: [],
      };
    }
    return undefined;
  }, [reactedEventId, reactedRelay, addressPointer]);

  // Fetch the reacted event
  const reactedEvent = useNostrEvent(eventPointer);

  // Map common reactions to icons
  const getReactionIcon = (content: string) => {
    switch (content) {
      case "❤️":
      case "♥️":
      case "+":
        return <Heart className="size-4 fill-red-500 text-red-500" />;
      case "👍":
        return <ThumbsUp className="size-4 fill-green-500 text-green-500" />;
      case "👎":
        return <ThumbsDown className="size-4 fill-red-500 text-red-500" />;
      case "🔥":
        return <Flame className="size-4 fill-orange-500 text-orange-500" />;
      case "😄":
      case "😊":
        return <Smile className="size-4 fill-yellow-500 text-yellow-500" />;
      default:
        return <span className="text-xl">{content}</span>;
    }
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Reaction indicator */}
        <div className="flex items-center gap-2">
          {parsedReaction.type === "custom" ? (
            <img
              src={parsedReaction.url}
              alt={`:${parsedReaction.shortcode}:`}
              title={`:${parsedReaction.shortcode}:`}
              className="size-6 inline-block"
            />
          ) : (
            getReactionIcon(parsedReaction.emoji)
          )}
        </div>

        {/* Embedded event (if loaded) */}
        {reactedEvent && (
          <div className="border border-muted">
            <EmbeddedEvent event={reactedEvent} />
          </div>
        )}

        {/* Loading state */}
        {reactedEventId && !reactedEvent && (
          <div className="border border-muted p-2">
            <EventCardSkeleton variant="compact" showActions={false} />
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Embedded event renderer - uses KindRenderer for recursive rendering
 */
function EmbeddedEvent({ event }: { event: NostrEvent }) {
  return <KindRenderer event={event} />;
}
