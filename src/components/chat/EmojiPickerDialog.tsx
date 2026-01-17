import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { EmojiTag } from "@/lib/emoji-helpers";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useEmojiFrequency } from "@/hooks/useEmojiFrequency";
import { CustomEmoji } from "../nostr/CustomEmoji";

interface EmojiPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmojiSelect: (emoji: string, customEmoji?: EmojiTag) => void;
  /** Optional context event to extract custom emoji from */
  contextEmojis?: EmojiTag[];
}

/**
 * EmojiPickerDialog - Searchable emoji picker for reactions
 *
 * Features:
 * - Real-time search using FlexSearch
 * - Frequently used emoji at top when no search query
 * - Quick reaction bar for common emojis
 * - Supports both unicode and NIP-30 custom emoji
 * - Tracks usage in IndexedDB via EmojiFrequencyService
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

  // Use emoji frequency tracking
  const { topEmojis, recordUnicodeUsage, recordCustomUsage } =
    useEmojiFrequency(8);

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

  // Convert topEmojis from frequency service to EmojiSearchResult format
  const frequentlyUsedResults = useMemo(() => {
    const results: EmojiSearchResult[] = [];
    for (const freq of topEmojis) {
      if (freq.source === "custom") {
        // Custom emoji - try to get from search service for full data
        const fromService = service.getByShortcode(freq.shortcode);
        if (fromService) {
          results.push(fromService);
        } else if (freq.url) {
          // Fallback to stored data
          results.push({
            shortcode: freq.shortcode,
            url: freq.url,
            source: "custom",
          });
        }
      } else {
        // Unicode emoji - search in service or use stored data
        const fromService = service.getByShortcode(freq.shortcode);
        if (fromService) {
          results.push(fromService);
        } else {
          // Fallback: key is the emoji char for unicode
          results.push({
            shortcode: freq.shortcode,
            url: freq.key,
            source: "unicode",
          });
        }
      }
    }
    return results;
  }, [topEmojis, service]);

  // Combine recently used with search results for display
  // When no search query: show recently used first, then fill with other emoji
  // When searching: show search results
  const displayEmojis = useMemo(() => {
    if (searchQuery.trim()) {
      // Show search results
      return searchResults;
    }

    // No search query: prioritize recently used, then fill with other emoji
    if (frequentlyUsedResults.length > 0) {
      const recentSet = new Set(
        frequentlyUsedResults.map((r) =>
          r.source === "unicode" ? r.url : `:${r.shortcode}:`,
        ),
      );

      // Get additional emoji to fill to 8, excluding recently used
      const additional = searchResults
        .filter((r) => {
          const key = r.source === "unicode" ? r.url : `:${r.shortcode}:`;
          return !recentSet.has(key);
        })
        .slice(0, 8 - frequentlyUsedResults.length);

      return [...frequentlyUsedResults, ...additional].slice(0, 8);
    }

    // No history: just show top 8 emoji (which will be defaults on cold start)
    return searchResults;
  }, [searchQuery, searchResults, frequentlyUsedResults]);

  const handleEmojiClick = (result: EmojiSearchResult) => {
    if (result.source === "unicode") {
      // For unicode emoji, the "url" field contains the emoji character
      onEmojiSelect(result.url);
      recordUnicodeUsage(result.url, result.shortcode);
    } else {
      // For custom emoji, pass the shortcode as content and emoji tag info
      onEmojiSelect(`:${result.shortcode}:`, {
        shortcode: result.shortcode,
        url: result.url,
        collection: result.collection,
      });
      recordCustomUsage(result.shortcode, result.url);
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
