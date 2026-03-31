import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { EmojiSearchResult } from "@/services/emoji-search";
import { recordEmojiUsage, getRecentEmojiKeys } from "@/services/emoji-usage";
import type { EmojiTag } from "@/lib/emoji-helpers";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";

interface EmojiPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmojiSelect: (emoji: string, customEmoji?: EmojiTag) => void;
  /** Optional context event to extract custom emoji from */
  contextEmojis?: EmojiTag[];
}

const ITEM_HEIGHT = 40;
const MAX_VISIBLE = 8;

/**
 * EmojiPickerDialog - Searchable emoji picker for reactions
 *
 * Layout: top (recently used) emojis → search bar → scrollable list
 * This keeps the dialog close button away from the search input.
 *
 * Features:
 * - Recently used emojis shown as quick-pick buttons at the top
 * - Real-time search using FlexSearch with scrollable virtualized results
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
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // Get frequently used emojis ranked by recency+frequency
  const frequentlyUsed = useMemo(() => {
    return getRecentEmojiKeys(50);
  }, []);

  // Resolve top 8 recently used emojis to EmojiSearchResult for rendering
  const topEmojis = useMemo<EmojiSearchResult[]>(() => {
    if (frequentlyUsed.length === 0) return [];
    const results: EmojiSearchResult[] = [];
    for (const emojiStr of frequentlyUsed.slice(0, 8)) {
      if (emojiStr.startsWith(":") && emojiStr.endsWith(":")) {
        const shortcode = emojiStr.slice(1, -1);
        const custom = service.getByShortcode(shortcode);
        if (custom) results.push(custom);
      } else {
        const found = searchResults.find((r) => r.url === emojiStr);
        if (found) results.push(found);
      }
    }
    return results;
  }, [frequentlyUsed, searchResults, service]);

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
      recordEmojiUsage(result);
      if (result.source === "unicode") {
        onEmojiSelect(result.url);
      } else {
        onEmojiSelect(`:${result.shortcode}:`, {
          shortcode: result.shortcode,
          url: result.url,
          address: result.address,
        });
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
          <span className="truncate text-sm text-popover-foreground">
            :{item.shortcode}:
          </span>
        </button>
      );
    },
    [displayEmojis, selectedIndex, handleEmojiClick],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xs p-0 gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus();
        }}
      >
        {/* Top emojis — recently used quick-picks.
            This section also provides natural spacing for the dialog close (X) button,
            which is absolutely positioned at top-right of the dialog. */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-2 pr-10 min-h-[48px]">
          {topEmojis.length > 0 ? (
            <div
              className="flex items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {topEmojis.map((emoji) => (
                <button
                  key={emoji.shortcode}
                  onClick={() => handleEmojiClick(emoji)}
                  title={`:${emoji.shortcode}:`}
                  className="flex size-8 items-center justify-center rounded hover:bg-muted/60 transition-colors flex-shrink-0"
                >
                  {emoji.source === "unicode" ? (
                    <span className="text-lg leading-none">{emoji.url}</span>
                  ) : (
                    <img
                      src={emoji.url}
                      alt={`:${emoji.shortcode}:`}
                      className="size-6 object-contain"
                      loading="lazy"
                    />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs font-medium text-muted-foreground select-none">
              Emoji
            </span>
          )}
        </div>

        {/* Search bar */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search emojis..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9"
            />
          </div>
        </div>

        {/* Scrollable emoji list */}
        {displayEmojis.length > 0 ? (
          <div
            role="listbox"
            className="border-t border-border/50 bg-popover text-popover-foreground"
          >
            <Virtuoso
              ref={virtuosoRef}
              totalCount={displayEmojis.length}
              fixedItemHeight={ITEM_HEIGHT}
              style={{
                height: listHeight,
                overflow:
                  displayEmojis.length <= MAX_VISIBLE ? "hidden" : "auto",
              }}
              className="[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/60 [&::-webkit-scrollbar-track]:bg-transparent"
              itemContent={renderItem}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground border-t border-border/50">
            No emojis found
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
