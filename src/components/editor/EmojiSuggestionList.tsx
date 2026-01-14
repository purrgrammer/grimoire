import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { EmojiSearchResult } from "@/services/emoji-search";
import { cn } from "@/lib/utils";
import type { EmojiCategory } from "@/lib/unicode-emojis";
import { EMOJI_CATEGORIES } from "@/lib/unicode-emojis";

export interface EmojiSuggestionListProps {
  items: EmojiSearchResult[];
  command: (item: EmojiSearchResult) => void;
  onClose?: () => void;
  /** Frequently used emoji shortcodes */
  frequentlyUsed?: string[];
  /** Callback to get emojis by category */
  getByCategory?: (category: EmojiCategory) => EmojiSearchResult[];
  /** Current search query (empty means show categories/recent) */
  query?: string;
}

export interface EmojiSuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const GRID_COLS = 8;

export const EmojiSuggestionList = forwardRef<
  EmojiSuggestionListHandle,
  EmojiSuggestionListProps
>(
  (
    { items, command, onClose, frequentlyUsed = [], getByCategory, query = "" },
    ref,
  ) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState<
      EmojiCategory | "recent" | null
    >(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Determine what to show
    const isSearching = query.trim().length > 0;
    const showCategories = !isSearching && !selectedCategory;
    const showRecent =
      selectedCategory === "recent" &&
      !isSearching &&
      frequentlyUsed.length > 0;

    // Get current display items
    let displayItems: EmojiSearchResult[] = items;

    if (showRecent) {
      // Show frequently used emojis
      displayItems = items.filter((item) =>
        frequentlyUsed.includes(item.shortcode),
      );
    } else if (selectedCategory && selectedCategory !== "recent") {
      // Show category emojis
      displayItems = getByCategory
        ? getByCategory(selectedCategory)
        : items.filter((item) => item.category === selectedCategory);
    }

    // Keyboard navigation with grid support
    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        // Tab navigation between categories when not searching
        if (event.key === "Tab" && !isSearching) {
          event.preventDefault();
          const categories: Array<EmojiCategory | "recent"> = [
            "recent",
            ...Object.keys(EMOJI_CATEGORIES),
          ] as Array<EmojiCategory | "recent">;
          const currentIndex = selectedCategory
            ? categories.indexOf(selectedCategory)
            : -1;
          const nextIndex = event.shiftKey
            ? currentIndex - 1
            : currentIndex + 1;

          if (nextIndex < 0) {
            setSelectedCategory(null); // Go back to showing all
          } else if (nextIndex >= categories.length) {
            setSelectedCategory(null); // Wrap around
          } else {
            setSelectedCategory(categories[nextIndex]);
          }
          setSelectedIndex(0);
          return true;
        }

        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => {
            const newIndex = prev - GRID_COLS;
            return newIndex < 0
              ? Math.max(0, displayItems.length + newIndex)
              : newIndex;
          });
          return true;
        }

        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => {
            const newIndex = prev + GRID_COLS;
            return newIndex >= displayItems.length
              ? Math.min(displayItems.length - 1, newIndex % GRID_COLS)
              : newIndex;
          });
          return true;
        }

        if (event.key === "ArrowLeft") {
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : displayItems.length - 1,
          );
          return true;
        }

        if (event.key === "ArrowRight") {
          setSelectedIndex((prev) =>
            prev < displayItems.length - 1 ? prev + 1 : 0,
          );
          return true;
        }

        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
          if (displayItems[selectedIndex]) {
            command(displayItems[selectedIndex]);
          }
          return true;
        }

        if (event.key === "Escape") {
          // If in a category, go back to all categories
          if (selectedCategory && !isSearching) {
            setSelectedCategory(null);
            setSelectedIndex(0);
            return true;
          }
          onClose?.();
          return true;
        }

        return false;
      },
    }));

    // Scroll selected item into view
    useEffect(() => {
      const selectedElement = listRef.current?.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
        });
      }
    }, [selectedIndex]);

    // Reset selected index when items or category change
    useEffect(() => {
      setSelectedIndex(0);
    }, [displayItems.length, selectedCategory]);

    // Reset category when searching
    useEffect(() => {
      if (isSearching) {
        setSelectedCategory(null);
      }
    }, [isSearching]);

    if (items.length === 0 && isSearching) {
      return (
        <div className="border border-border/50 bg-popover p-4 text-sm text-muted-foreground shadow-md">
          No emoji found
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        role="listbox"
        className="w-[360px] border border-border/50 bg-popover shadow-md"
      >
        {/* Category tabs - only show when not searching */}
        {!isSearching && (
          <div className="flex items-center gap-0.5 border-b border-border/50 bg-muted/30 p-1">
            <button
              onClick={() => setSelectedCategory("recent")}
              className={cn(
                "flex size-7 items-center justify-center rounded text-sm transition-colors",
                selectedCategory === "recent"
                  ? "bg-background"
                  : "hover:bg-muted",
              )}
              title="Recently used"
            >
              🕒
            </button>
            {(
              Object.entries(EMOJI_CATEGORIES) as Array<
                [EmojiCategory, { label: string; icon: string }]
              >
            ).map(([category, { icon, label }]) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={cn(
                  "flex size-7 items-center justify-center rounded text-sm transition-colors",
                  selectedCategory === category
                    ? "bg-background"
                    : "hover:bg-muted",
                )}
                title={label}
              >
                {icon}
              </button>
            ))}
          </div>
        )}

        {/* Emoji grid */}
        <div className="max-h-[240px] overflow-y-auto p-2">
          {showCategories && (
            <div className="text-center text-xs text-muted-foreground">
              Select a category above or start typing to search
            </div>
          )}

          {displayItems.length > 0 && (
            <div className="grid grid-cols-8 gap-0.5">
              {displayItems.slice(0, 64).map((item, index) => (
                <button
                  key={`${item.shortcode}-${item.source}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onClick={() => command(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded transition-colors",
                    index === selectedIndex ? "bg-muted" : "hover:bg-muted/60",
                  )}
                  title={`:${item.shortcode}:`}
                >
                  {item.source === "unicode" ? (
                    // Unicode emoji - render as text
                    <span className="text-lg leading-none">{item.url}</span>
                  ) : (
                    // Custom emoji - render as image
                    <img
                      src={item.url}
                      alt={`:${item.shortcode}:`}
                      className="size-6 object-contain"
                      loading="lazy"
                      onError={(e) => {
                        // Replace with fallback on error
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {showRecent && displayItems.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No recently used emojis yet
              <br />
              Start using emojis to see them here
            </div>
          )}
        </div>

        {/* Footer with selected emoji info */}
        {displayItems[selectedIndex] && (
          <div className="border-t border-border/50 bg-muted/30 px-2 py-1.5 text-center text-xs">
            <span className="text-muted-foreground">
              :{displayItems[selectedIndex].shortcode}:
            </span>
            {displayItems[selectedIndex].keywords &&
              displayItems[selectedIndex].keywords!.length > 0 && (
                <span className="ml-2 text-muted-foreground/70">
                  {displayItems[selectedIndex].keywords!.slice(0, 3).join(", ")}
                </span>
              )}
          </div>
        )}
      </div>
    );
  },
);

EmojiSuggestionList.displayName = "EmojiSuggestionList";
