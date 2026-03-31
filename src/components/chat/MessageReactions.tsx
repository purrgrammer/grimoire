import { Fragment, useMemo, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { cn } from "@/lib/utils";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import accountManager from "@/services/accounts";
import { EMOJI_SHORTCODE_REGEX } from "@/lib/emoji-helpers";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { UserName } from "@/components/nostr/UserName";

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
        next: () => {
          // Events are automatically added to EventStore
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
        // Prefer oldest event's emoji tag (timeline is newest-first, so
        // later iterations are older). Some clients copy the shortcode
        // content but omit the emoji tag, so keep overwriting until we
        // reach the oldest event that has the full tag.
        if (customEmoji) {
          existing.customEmoji = customEmoji;
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
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex gap-2 max-w-full overflow-x-auto hide-scrollbar cursor-pointer">
          {aggregated.map((reaction) => (
            <ReactionBadge
              key={reaction.customEmoji?.shortcode || reaction.emoji}
              reaction={reaction}
            />
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-left w-auto p-2 text-sm" align="start">
        <div className="flex flex-col items-start gap-2">
          {aggregated.map((reaction) => (
            <div
              key={reaction.customEmoji?.shortcode || reaction.emoji}
              className="flex flex-col items-start gap-0.5"
            >
              {reaction.customEmoji ? (
                <img
                  src={reaction.customEmoji.url}
                  alt={`:${reaction.customEmoji.shortcode}:`}
                  className="size-4 inline-block object-contain"
                />
              ) : (
                <span>{reaction.emoji}</span>
              )}
              <span className="inline-flex items-baseline flex-wrap">
                {reaction.pubkeys.map((pk, i) => (
                  <Fragment key={pk}>
                    {i > 0 &&
                      (i === reaction.pubkeys.length - 1 ? (
                        <span className="text-muted-foreground mx-1">and</span>
                      ) : (
                        <span className="text-muted-foreground mr-1">,</span>
                      ))}
                    <UserName pubkey={pk} />
                  </Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReactionBadge({ reaction }: { reaction: ReactionSummary }) {
  const activeAccount = use$(accountManager.active$);
  const hasUserReacted = activeAccount?.pubkey
    ? reaction.pubkeys.includes(activeAccount.pubkey)
    : false;

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] leading-tight">
      {reaction.customEmoji ? (
        <img
          src={reaction.customEmoji.url}
          alt={`:${reaction.customEmoji.shortcode}:`}
          className="size-3.5 flex-shrink-0 object-contain"
        />
      ) : (
        <span className="text-xs leading-none flex-shrink-0">
          {reaction.emoji}
        </span>
      )}
      <span
        className={cn(
          hasUserReacted ? "text-highlight" : "text-muted-foreground",
        )}
      >
        {reaction.count}
      </span>
    </span>
  );
}
