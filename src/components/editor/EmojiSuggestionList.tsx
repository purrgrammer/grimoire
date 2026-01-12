import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { EmojiSearchResult } from "@/services/emoji-search";
import { cn } from "@/lib/utils";

export interface EmojiSuggestionListProps {
  items: EmojiSearchResult[];
  command: (item: EmojiSearchResult) => void;
  onClose?: () => void;
}

export interface EmojiSuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const GRID_COLS = 8;

export const EmojiSuggestionList = forwardRef<
  EmojiSuggestionListHandle,
  EmojiSuggestionListProps
>(({ items, command, onClose }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation with grid support
  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => {
          const newIndex = prev - GRID_COLS;
          return newIndex < 0 ? Math.max(0, items.length + newIndex) : newIndex;
        });
        return true;
      }

      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => {
          const newIndex = prev + GRID_COLS;
          return newIndex >= items.length
            ? Math.min(items.length - 1, newIndex % GRID_COLS)
            : newIndex;
        });
        return true;
      }

      if (event.key === "ArrowLeft") {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        return true;
      }

      if (event.key === "ArrowRight") {
        setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        return true;
      }

      if (event.key === "Enter") {
        if (items[selectedIndex]) {
          command(items[selectedIndex]);
        }
        return true;
      }

      if (event.key === "Escape") {
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

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  if (items.length === 0) {
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
      className="max-h-[240px] w-[296px] overflow-y-auto border border-border/50 bg-popover p-2 shadow-md"
    >
      <div className="grid grid-cols-8 gap-0.5">
        {items.map((item, index) => (
          <button
            key={`${item.shortcode}-${item.source}`}
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
      {/* Show selected emoji shortcode */}
      {items[selectedIndex] && (
        <div className="mt-2 border-t border-border/50 pt-2 text-center text-xs text-muted-foreground">
          :{items[selectedIndex].shortcode}:
        </div>
      )}
    </div>
  );
});

EmojiSuggestionList.displayName = "EmojiSuggestionList";
