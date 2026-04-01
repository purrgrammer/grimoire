import { useMemo, useEffect, useCallback, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { cn } from "@/lib/utils";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import accountManager from "@/services/accounts";
import { EMOJI_SHORTCODE_REGEX } from "@/lib/emoji-helpers";
import type { EmojiTag } from "@/lib/emoji-helpers";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation } from "@/types/chat";
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
  /** Chat adapter for sending reactions */
  adapter?: ChatProtocolAdapter;
  /** Conversation context for sending reactions */
  conversation?: Conversation;
}

interface ReactionSummary {
  emoji: string;
  count: number;
  pubkeys: string[];
  firstSeen: number;
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
export function MessageReactions({
  messageId,
  relays,
  adapter,
  conversation,
}: MessageReactionsProps) {
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
        existing.firstSeen = Math.min(existing.firstSeen, reaction.created_at);
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
          firstSeen: reaction.created_at,
          customEmoji,
        });
      }
    }

    // Sort by first-seen timestamp so group order is stable regardless of arrival order
    return Array.from(map.values()).sort((a, b) => a.firstSeen - b.firstSeen);
  }, [reactions]);

  const activeAccount = use$(accountManager.active$);
  const canSign = !!activeAccount?.signer;

  const [sendingEmoji, setSendingEmoji] = useState<string | null>(null);

  const handleReact = useCallback(
    async (reaction: ReactionSummary) => {
      if (!adapter || !conversation || !canSign) return;

      const emojiKey = reaction.customEmoji
        ? `:${reaction.customEmoji.shortcode}:`
        : reaction.emoji;
      setSendingEmoji(emojiKey);

      const customEmoji: EmojiTag | undefined = reaction.customEmoji
        ? {
            shortcode: reaction.customEmoji.shortcode,
            url: reaction.customEmoji.url,
          }
        : undefined;

      try {
        await adapter.sendReaction(
          conversation,
          messageId,
          reaction.emoji,
          customEmoji,
        );
      } catch (err) {
        console.error(
          `[MessageReactions] Failed to send reaction for ${messageId.slice(0, 8)}...`,
          err,
        );
      } finally {
        setSendingEmoji(null);
      }
    },
    [adapter, conversation, messageId, canSign],
  );

  // Don't render if no reactions
  if (aggregated.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex gap-2 max-w-full overflow-x-auto hide-scrollbar cursor-pointer"
        >
          {aggregated.map((reaction) => {
            const hasUserReacted = activeAccount?.pubkey
              ? reaction.pubkeys.includes(activeAccount.pubkey)
              : false;
            return (
              <ReactionBadge
                key={reaction.customEmoji?.shortcode || reaction.emoji}
                reaction={reaction}
                hasUserReacted={hasUserReacted}
              />
            );
          })}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="text-left w-56 p-2 max-h-64 overflow-y-auto"
        align="start"
      >
        <div className="flex flex-col gap-2">
          {aggregated.map((reaction) => {
            const hasReacted = activeAccount?.pubkey
              ? reaction.pubkeys.includes(activeAccount.pubkey)
              : false;
            const emojiKey = reaction.customEmoji
              ? `:${reaction.customEmoji.shortcode}:`
              : reaction.emoji;
            const isSending = sendingEmoji === emojiKey;
            const isTappable = canSign && !hasReacted && !isSending;

            return (
              <div
                key={reaction.customEmoji?.shortcode || reaction.emoji}
                className="flex flex-col gap-1"
              >
                <div className="inline-flex items-center gap-2 text-sm">
                  {isTappable ? (
                    <button
                      type="button"
                      className="cursor-pointer hover:bg-muted rounded px-1 -mx-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReact(reaction);
                      }}
                      title="React"
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
                    </button>
                  ) : reaction.customEmoji ? (
                    <img
                      src={reaction.customEmoji.url}
                      alt={`:${reaction.customEmoji.shortcode}:`}
                      className={cn(
                        "size-4 inline-block object-contain",
                        isSending && "animate-pulse",
                      )}
                    />
                  ) : (
                    <span className={cn(isSending && "animate-pulse")}>
                      {reaction.emoji}
                    </span>
                  )}
                  <span className="text-muted-foreground text-sm">
                    {reaction.count}
                  </span>
                </div>
                <div className="flex flex-col">
                  {reaction.pubkeys.map((pk) => (
                    <UserName key={pk} pubkey={pk} className="text-xs" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReactionBadge({
  reaction,
  hasUserReacted,
}: {
  reaction: ReactionSummary;
  hasUserReacted: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs leading-none">
      {reaction.customEmoji ? (
        <img
          src={reaction.customEmoji.url}
          alt={`:${reaction.customEmoji.shortcode}:`}
          className="size-3.5 flex-shrink-0 object-contain"
        />
      ) : (
        <span className="flex-shrink-0">{reaction.emoji}</span>
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
