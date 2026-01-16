import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { EmojiTag } from "@/lib/emoji-helpers";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { CustomEmoji } from "../nostr/CustomEmoji";

interface EmojiPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmojiSelect: (emoji: string, customEmoji?: EmojiTag) => void;
  /** Optional context event to extract custom emoji from */
  contextEmojis?: EmojiTag[];
}

// Frequently used emojis stored in localStorage
const STORAGE_KEY = "grimoire:reaction-history";

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

  // Use the same emoji search hook as chat autocomplete
  const { service } = useEmojiSearch();

  // Add context emojis when they change
  useEffect(() => {
    if (contextEmojis.length > 0) {
      for (const emoji of contextEmojis) {
        service.addEmoji(emoji.shortcode, emoji.url, "context");
      }
    }
  }, [contextEmojis, service]);

  // Perform search when query changes
  useEffect(() => {
    const performSearch = async () => {
      // Always fetch 8 emoji (1 row of 8) for consistent height
      const results = await service.search(searchQuery, { limit: 8 });
      setSearchResults(results);
    };
    performSearch();
  }, [searchQuery, service]);

  // Get frequently used emojis from history
  const frequentlyUsed = useMemo(() => {
    const history = getReactionHistory();
    return Object.entries(history)
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .slice(0, 8) // Max 1 row
      .map(([emoji]) => emoji);
  }, []);

  // Combine recently used with search results for display
  // When no search query: show recently used first, then fill with other emoji
  // When searching: show search results
  const displayEmojis = useMemo(() => {
    if (searchQuery.trim()) {
      // Show search results
      return searchResults;
    }

    // No search query: prioritize recently used, then fill with other emoji
    if (frequentlyUsed.length > 0) {
      const recentSet = new Set(frequentlyUsed);
      // Get additional emoji to fill to 8, excluding recently used
      const additional = searchResults
        .filter((r) => {
          const key = r.source === "unicode" ? r.url : `:${r.shortcode}:`;
          return !recentSet.has(key);
        })
        .slice(0, 8 - frequentlyUsed.length);

      // Combine: recently used get priority, but displayed as regular emoji
      const recentResults: EmojiSearchResult[] = [];
      for (const emojiStr of frequentlyUsed) {
        if (emojiStr.startsWith(":") && emojiStr.endsWith(":")) {
          const shortcode = emojiStr.slice(1, -1);
          const customEmoji = service.getByShortcode(shortcode);
          if (customEmoji) {
            recentResults.push(customEmoji);
          }
        } else {
          // Unicode emoji - find it in search results
          const found = searchResults.find((r) => r.url === emojiStr);
          if (found) recentResults.push(found);
        }
      }

      return [...recentResults, ...additional].slice(0, 8);
    }

    // No history: just show top 8 emoji
    return searchResults;
  }, [searchQuery, searchResults, frequentlyUsed, service]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {/* Search input */}
        <div className="relative mt-4">
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

        {/* Fixed 1-row emoji grid (8 emoji) with consistent height */}
        <div className="grid grid-cols-8 items-center gap-3 h-[1.5rem]">
          {displayEmojis.length > 0 ? (
            displayEmojis.map((result) => (
              <button
                key={`${result.source}:${result.shortcode}`}
                onClick={() => handleEmojiClick(result)}
                className="hover:bg-muted rounded p-2 transition-colors flex items-center justify-center aspect-square"
                title={`:${result.shortcode}:`}
              >
                {result.source === "unicode" ? (
                  <span className="text-xl leading-none">{result.url}</span>
                ) : (
                  <CustomEmoji
                    size="md"
                    shortcode={result.shortcode}
                    url={result.url}
                  />
                )}
              </button>
            ))
          ) : (
            <div className="col-span-8 flex items-center justify-center text-sm text-muted-foreground">
              No emojis found
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
