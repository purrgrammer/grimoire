import type { NostrEvent } from "@/types/nostr";
import { useMemo } from "react";
import { Heart, ThumbsUp, ThumbsDown, Flame, Smile } from "lucide-react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { RichText } from "../RichText";

/**
 * Compact preview for Kind 7 (Reaction)
 * Shows the reaction emoji/content + preview of reacted content
 */
export function ReactionCompactPreview({ event }: { event: NostrEvent }) {
  const reaction = event.content || "+";

  // NIP-30: Custom emoji support
  const emojiTags = event.tags.filter((tag) => tag[0] === "emoji");
  const customEmojis = useMemo(() => {
    const map: Record<string, string> = {};
    emojiTags.forEach((tag) => {
      if (tag[1] && tag[2]) {
        map[tag[1]] = tag[2];
      }
    });
    return map;
  }, [emojiTags]);

  // Parse reaction content for custom emoji
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
  const reactedRelay = eTag?.[2];

  // Get the address being reacted to (a tag for replaceable events)
  const aTag = event.tags.find((tag) => tag[0] === "a");
  const reactedAddress = aTag?.[1];

  // Parse a tag into components
  const addressParts = useMemo(() => {
    if (!reactedAddress) return null;
    const parts = reactedAddress.split(":");
    return {
      kind: parseInt(parts[0], 10),
      pubkey: parts[1],
      dTag: parts[2],
    };
  }, [reactedAddress]);

  // Create event pointer for fetching
  const eventPointer = useMemo(() => {
    if (reactedEventId) {
      return {
        id: reactedEventId,
        relays: reactedRelay ? [reactedRelay] : undefined,
      };
    }
    if (addressParts) {
      return {
        kind: addressParts.kind,
        pubkey: addressParts.pubkey,
        identifier: addressParts.dTag || "",
        relays: [],
      };
    }
    return undefined;
  }, [reactedEventId, reactedRelay, addressParts]);

  // Fetch the reacted event
  const reactedEvent = useNostrEvent(eventPointer);

  // Map common reactions to icons for compact display
  const getReactionDisplay = (content: string) => {
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
        return <span className="text-base">{content}</span>;
    }
  };

  return (
    <span className="flex items-center gap-1 text-sm truncate">
      {parsedReaction.type === "custom" ? (
        <img
          src={parsedReaction.url}
          alt={`:${parsedReaction.shortcode}:`}
          title={`:${parsedReaction.shortcode}:`}
          className="size-3.5 inline-block shrink-0"
        />
      ) : (
        <span className="shrink-0">
          {getReactionDisplay(parsedReaction.emoji)}
        </span>
      )}
      {reactedEvent && (
        <>
          <UserName pubkey={reactedEvent.pubkey} className="text-sm shrink-0" />
          <span className="text-muted-foreground truncate">
            <RichText
              event={reactedEvent}
              className="inline text-sm truncate line-clamp-1 leading-none"
              options={{ showMedia: false, showEventEmbeds: false }}
            />
          </span>
        </>
      )}
    </span>
  );
}
