import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { EmojiTag } from "@/lib/emoji-helpers";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";

interface EmojiPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmojiSelect: (emoji: string, customEmoji?: EmojiTag) => void;
  /** Optional context event to extract custom emoji from */
  contextEmojis?: EmojiTag[];
}

// Frequently used emojis stored in localStorage
const STORAGE_KEY = "grimoire:reaction-history";

const ITEM_HEIGHT = 40;
const MAX_VISIBLE = 8;

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
 * - Real-time search using FlexSearch with scrollable virtualized results
 * - Frequently used emoji at top when no search query
 * - Supports both unicode and NIP-30 custom emoji
 * - Keyboard navigation (arrow keys, enter, escape)
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Use the same emoji search hook as chat autocomplete
  const { service } = useEmojiSearch();

  // Add context emojis when they change
  useEffect(() => {
    if (contextEmojis.length > 0) {
      for (const emoji of contextEmojis) {
        service.addEmoji(emoji.shortcode, emoji.url, "context", emoji.address);
      }
    }
  }, [contextEmojis, service]);

  // Perform search when query changes
  useEffect(() => {
    const performSearch = async () => {
      const results = await service.search(searchQuery, { limit: 200 });
      setSearchResults(results);
      setSelectedIndex(0);
    };
    performSearch();
  }, [searchQuery, service]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  // Get frequently used emojis from history
  const frequentlyUsed = useMemo(() => {
    const history = getReactionHistory();
    return Object.entries(history)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji]) => emoji);
  }, []);

  // When no search query: show recently used first, then fill with search results
  // When searching: show search results only
  const displayEmojis = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults;
    }

    if (frequentlyUsed.length > 0) {
      const recentSet = new Set(frequentlyUsed);
      const additional = searchResults.filter((r) => {
        const key = r.source === "unicode" ? r.url : `:${r.shortcode}:`;
        return !recentSet.has(key);
      });

      const recentResults: EmojiSearchResult[] = [];
      for (const emojiStr of frequentlyUsed) {
        if (emojiStr.startsWith(":") && emojiStr.endsWith(":")) {
          const shortcode = emojiStr.slice(1, -1);
          const customEmoji = service.getByShortcode(shortcode);
          if (customEmoji) recentResults.push(customEmoji);
        } else {
          const found = searchResults.find((r) => r.url === emojiStr);
          if (found) recentResults.push(found);
        }
      }

      return [...recentResults, ...additional];
    }

    return searchResults;
  }, [searchQuery, searchResults, frequentlyUsed, service]);

  const handleEmojiClick = useCallback(
    (result: EmojiSearchResult) => {
      if (result.source === "unicode") {
        onEmojiSelect(result.url);
        updateReactionHistory(result.url);
      } else {
        onEmojiSelect(`:${result.shortcode}:`, {
          shortcode: result.shortcode,
          url: result.url,
          address: result.address,
        });
        updateReactionHistory(`:${result.shortcode}:`);
      }
      onOpenChange(false);
    },
    [onEmojiSelect, onOpenChange],
  );

  // Keyboard navigation in the search input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < displayEmojis.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : displayEmojis.length - 1,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (displayEmojis[selectedIndex]) {
          handleEmojiClick(displayEmojis[selectedIndex]);
        }
      }
    },
    [displayEmojis, selectedIndex, handleEmojiClick],
  );

  // Scroll selected item into view
  useEffect(() => {
    virtuosoRef.current?.scrollIntoView({
      index: selectedIndex,
      behavior: "auto",
    });
  }, [selectedIndex]);

  const listHeight = Math.min(displayEmojis.length, MAX_VISIBLE) * ITEM_HEIGHT;

  const renderItem = useCallback(
    (index: number) => {
      const item = displayEmojis[index];
      return (
        <button
          role="option"
          aria-selected={index === selectedIndex}
          onClick={(e) => {
            e.preventDefault();
            handleEmojiClick(item);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
            index === selectedIndex ? "bg-muted/60" : "hover:bg-muted/60"
          }`}
        >
          <span className="flex size-7 items-center justify-center flex-shrink-0">
            {item.source === "unicode" ? (
              <span className="text-lg leading-none">{item.url}</span>
            ) : (
              <img
                src={item.url}
                alt={`:${item.shortcode}:`}
                className="size-6 object-contain"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
          </span>
          <span className="truncate text-sm text-popover-foreground/80">
            :{item.shortcode}:
          </span>
        </button>
      );
    },
    [displayEmojis, selectedIndex, handleEmojiClick],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs p-4 gap-2">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search emojis..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9"
            autoFocus
          />
        </div>

        {/* Scrollable emoji list */}
        {displayEmojis.length > 0 ? (
          <div
            role="listbox"
            className="rounded-md border border-border/50 bg-popover text-popover-foreground overflow-hidden"
          >
            <Virtuoso
              ref={virtuosoRef}
              totalCount={displayEmojis.length}
              fixedItemHeight={ITEM_HEIGHT}
              style={{ height: listHeight }}
              itemContent={renderItem}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            No emojis found
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
