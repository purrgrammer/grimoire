import { useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { EMOJI_SHORTCODE_REGEX } from "@/lib/emoji-helpers";
import type { NostrEvent } from "@/types/nostr";

interface MessageReactionsProps {
  messageId: string;
  /** Relay URL for fetching reactions (NIP-29 group relay) */
  relayUrl?: string;
}

interface ReactionSummary {
  emoji: string;
  count: number;
  pubkeys: string[];
  customEmoji?: {
    shortcode: string;
    url: string;
  };
}

/**
 * MessageReactions - Lazy loads and displays reactions for a single message
 *
 * Loads kind 7 (reaction) events that reference the messageId via e-tag.
 * Aggregates by emoji and displays as tiny inline badges in bottom-right corner.
 *
 * Uses EventStore timeline for reactive updates - new reactions appear automatically.
 */
export function MessageReactions({
  messageId,
  relayUrl,
}: MessageReactionsProps) {
  // Load reactions for this message from EventStore
  // Filter: kind 7, e-tag pointing to messageId
  const reactions = use$(
    () =>
      eventStore.timeline({
        kinds: [7],
        "#e": [messageId],
      }),
    [messageId],
  );

  // Aggregate reactions by emoji
  const aggregated = useMemo(() => {
    if (!reactions || reactions.length === 0) return [];

    const map = new Map<string, ReactionSummary>();

    for (const reaction of reactions) {
      const content = reaction.content || "❤️";

      // Check for NIP-30 custom emoji tags
      const emojiTag = reaction.tags.find((t) => t[0] === "emoji");
      let customEmoji: { shortcode: string; url: string } | undefined;

      if (emojiTag && emojiTag[1] && emojiTag[2]) {
        customEmoji = {
          shortcode: emojiTag[1],
          url: emojiTag[2],
        };
      }

      // Parse content for custom emoji shortcodes
      const match = content.match(EMOJI_SHORTCODE_REGEX);
      const emojiKey =
        match && customEmoji ? `:${customEmoji.shortcode}:` : content;

      const existing = map.get(emojiKey);

      if (existing) {
        // Deduplicate by pubkey (one reaction per user per emoji)
        if (!existing.pubkeys.includes(reaction.pubkey)) {
          existing.count++;
          existing.pubkeys.push(reaction.pubkey);
        }
      } else {
        map.set(emojiKey, {
          emoji: content,
          count: 1,
          pubkeys: [reaction.pubkey],
          customEmoji,
        });
      }
    }

    // Sort by count descending, then by emoji alphabetically
    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.emoji.localeCompare(b.emoji);
    });
  }, [reactions]);

  // Don't render if no reactions
  if (aggregated.length === 0) return null;

  return (
    <div className="absolute bottom-0.5 right-1 flex gap-0.5">
      {aggregated.map((reaction) => (
        <span
          key={reaction.customEmoji?.shortcode || reaction.emoji}
          className="inline-flex items-center gap-0.5 px-1 rounded bg-muted/80 text-[10px] leading-tight"
          title={`${reaction.count} reaction${reaction.count > 1 ? "s" : ""}`}
        >
          {reaction.customEmoji ? (
            <img
              src={reaction.customEmoji.url}
              alt={`:${reaction.customEmoji.shortcode}:`}
              className="size-3 inline-block"
            />
          ) : (
            <span className="text-xs">{reaction.emoji}</span>
          )}
          <span className="text-muted-foreground">{reaction.count}</span>
        </span>
      ))}
    </div>
  );
}
