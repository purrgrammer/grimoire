import { useMemo, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { EMOJI_SHORTCODE_REGEX } from "@/lib/emoji-helpers";
import { getDisplayName } from "@/lib/nostr-utils";

interface MessageReactionsProps {
  messageId: string;
  /** Relay URLs for fetching reactions - protocol-specific */
  relays: string[];
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
 * Fetches reactions from protocol-specific relays and uses EventStore timeline
 * for reactive updates - new reactions appear automatically.
 */
export function MessageReactions({ messageId, relays }: MessageReactionsProps) {
  // Start relay subscription to fetch reactions for this message
  useEffect(() => {
    if (relays.length === 0) return;

    const filter = {
      kinds: [7],
      "#e": [messageId],
      limit: 100, // Reasonable limit for reactions
    };

    // Subscribe to relays to fetch reactions
    const subscription = pool
      .subscription(relays, [filter], {
        eventStore, // Automatically add reactions to EventStore
      })
      .subscribe({
        next: (response) => {
          if (typeof response !== "string") {
            // Event received - it's automatically added to EventStore
            console.log(
              `[MessageReactions] Reaction received for ${messageId.slice(0, 8)}...`,
            );
          }
        },
        error: (err) => {
          console.error(
            `[MessageReactions] Subscription error for ${messageId.slice(0, 8)}...`,
            err,
          );
        },
      });

    // Cleanup subscription when component unmounts or messageId changes
    return () => {
      subscription.unsubscribe();
    };
  }, [messageId, relays]);

  // Load reactions for this message from EventStore
  // Filter: kind 7, e-tag pointing to messageId
  // This observable will update automatically as reactions arrive from the subscription above
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
    <>
      {aggregated.map((reaction) => (
        <ReactionBadge
          key={reaction.customEmoji?.shortcode || reaction.emoji}
          reaction={reaction}
        />
      ))}
    </>
  );
}

/**
 * Single reaction badge with tooltip showing who reacted
 */
function ReactionBadge({ reaction }: { reaction: ReactionSummary }) {
  // Load profiles for all reactors to get display names
  const profiles = use$(
    () => eventStore.profiles(reaction.pubkeys),
    [reaction.pubkeys],
  );

  // Build tooltip with emoji and list of names
  const tooltip = useMemo(() => {
    const names = reaction.pubkeys.map((pubkey) => {
      const profile = profiles?.get(pubkey);
      return getDisplayName(pubkey, profile);
    });

    // Format: "❤️ 3\nAlice, Bob, Carol" or "❤️ 1\nAlice"
    const emojiDisplay = reaction.customEmoji
      ? `:${reaction.customEmoji.shortcode}:`
      : reaction.emoji;
    return `${emojiDisplay} ${reaction.count}\n${names.join(", ")}`;
  }, [reaction, profiles]);

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] leading-tight"
      title={tooltip}
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
  );
}
