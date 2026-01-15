import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { EmojiSearchService } from "@/services/emoji-search";
import { UNICODE_EMOJIS } from "@/lib/unicode-emojis";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { EmojiTag } from "@/lib/emoji-helpers";

interface EmojiPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmojiSelect: (emoji: string, customEmoji?: EmojiTag) => void;
  /** Optional context event to extract custom emoji from */
  contextEmojis?: EmojiTag[];
}

// Frequently used emojis stored in localStorage
const STORAGE_KEY = "grimoire:reaction-history";
const QUICK_REACTIONS = ["❤️", "👍", "🔥", "😂", "🎉", "👀", "🤔", "💯"];

function getReactionHistory(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function updateReactionHistory(emoji: string): void {
  try {
    const history = getReactionHistory();
    history[emoji] = (history[emoji] || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.error(
      "[EmojiPickerDialog] Failed to update reaction history:",
      err,
    );
  }
}

/**
 * EmojiPickerDialog - Searchable emoji picker for reactions
 *
 * Features:
 * - Real-time search using FlexSearch
 * - Frequently used emoji at top when no search query
 * - Quick reaction bar for common emojis
 * - Supports both unicode and NIP-30 custom emoji
 * - Tracks usage in localStorage
 */
export function EmojiPickerDialog({
  open,
  onOpenChange,
  onEmojiSelect,
  contextEmojis = [],
}: EmojiPickerDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmojiSearchResult[]>([]);
  const [emojiService] = useState(() => new EmojiSearchService());

  // Initialize emoji service with unicode emojis
  useEffect(() => {
    // Load unicode emojis
    emojiService.addUnicodeEmojis(UNICODE_EMOJIS);

    // Load context emojis (from conversation messages)
    for (const emoji of contextEmojis) {
      emojiService.addEmoji(emoji.shortcode, emoji.url, "context");
    }
  }, [emojiService, contextEmojis]);

  // Search emojis when query changes
  useEffect(() => {
    const search = async () => {
      const results = await emojiService.search(searchQuery, { limit: 48 });
      setSearchResults(results);
    };
    search();
  }, [searchQuery, emojiService]);

  // Get frequently used emojis from history
  const frequentlyUsed = useMemo(() => {
    if (searchQuery.trim()) return []; // Only show when no search query

    const history = getReactionHistory();
    return Object.entries(history)
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .slice(0, 8)
      .map(([emoji]) => emoji);
  }, [searchQuery]);

  const handleEmojiClick = (result: EmojiSearchResult) => {
    if (result.source === "unicode") {
      // For unicode emoji, the "url" field contains the emoji character
      onEmojiSelect(result.url);
      updateReactionHistory(result.url);
    } else {
      // For custom emoji, pass the shortcode as content and emoji tag info
      onEmojiSelect(`:${result.shortcode}:`, {
        shortcode: result.shortcode,
        url: result.url,
      });
      updateReactionHistory(`:${result.shortcode}:`);
    }
    onOpenChange(false);
    setSearchQuery(""); // Reset search on close
  };

  const handleQuickReaction = (emoji: string) => {
    onEmojiSelect(emoji);
    updateReactionHistory(emoji);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>React with emoji</DialogTitle>
        </DialogHeader>

        {/* Quick reaction bar */}
        <div className="flex gap-2 pb-3 border-b">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleQuickReaction(emoji)}
              className="text-2xl hover:scale-125 transition-transform active:scale-110"
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search emojis..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {/* Frequently used section */}
        {frequentlyUsed.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2 font-medium">
              Frequently used
            </div>
            <div className="grid grid-cols-8 gap-2">
              {frequentlyUsed.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleQuickReaction(emoji)}
                  className="text-2xl hover:bg-muted rounded p-2 transition-colors"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Emoji grid */}
        <div className="max-h-[300px] overflow-y-auto">
          {searchResults.length > 0 ? (
            <div className="grid grid-cols-8 gap-2">
              {searchResults.map((result) => (
                <button
                  key={`${result.source}:${result.shortcode}`}
                  onClick={() => handleEmojiClick(result)}
                  className="hover:bg-muted rounded p-2 transition-colors flex items-center justify-center"
                  title={`:${result.shortcode}:`}
                >
                  {result.source === "unicode" ? (
                    <span className="text-2xl">{result.url}</span>
                  ) : (
                    <img
                      src={result.url}
                      alt={`:${result.shortcode}:`}
                      className="size-6"
                    />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No emojis found
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
