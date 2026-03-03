import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { EmojiSearchResult } from "@/services/emoji-search";

export interface EmojiSuggestionListProps {
  items: EmojiSearchResult[];
  command: (item: EmojiSearchResult) => void;
  onClose?: () => void;
}

export interface EmojiSuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const ITEM_HEIGHT = 40;
const MAX_VISIBLE = 8;

export const EmojiSuggestionList = forwardRef<
  EmojiSuggestionListHandle,
  EmojiSuggestionListProps
>(({ items, command, onClose }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Keyboard navigation (linear list)
  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }

      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }

      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
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

  // Scroll selected item into view via Virtuoso
  useEffect(() => {
    virtuosoRef.current?.scrollIntoView({
      index: selectedIndex,
      behavior: "auto",
    });
  }, [selectedIndex]);

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const renderItem = useCallback(
    (index: number) => {
      const item = items[index];
      return (
        <button
          role="option"
          aria-selected={index === selectedIndex}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            command(item);
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
    [items, selectedIndex, command],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border/50 bg-popover p-4 text-sm text-popover-foreground/60 shadow-md">
        No emoji found
      </div>
    );
  }

  const listHeight = Math.min(items.length, MAX_VISIBLE) * ITEM_HEIGHT;

  return (
    <div
      role="listbox"
      className="w-[260px] rounded-md border border-border/50 bg-popover text-popover-foreground shadow-md overflow-hidden"
    >
      <Virtuoso
        ref={virtuosoRef}
        totalCount={items.length}
        fixedItemHeight={ITEM_HEIGHT}
        style={{
          height: listHeight,
          overflow: items.length <= MAX_VISIBLE ? "hidden" : "auto",
        }}
        itemContent={renderItem}
      />
    </div>
  );
});

EmojiSuggestionList.displayName = "EmojiSuggestionList";
