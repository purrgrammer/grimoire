import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ProfileSearchResult } from "@/services/profile-search";
import { UserName } from "../nostr/UserName";

export interface ProfileSuggestionListProps {
  items: ProfileSearchResult[];
  command: (item: ProfileSearchResult) => void;
  onClose?: () => void;
}

export interface ProfileSuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const ProfileSuggestionList = forwardRef<
  ProfileSuggestionListHandle,
  ProfileSuggestionListProps
>(({ items, command, onClose }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation
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

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = listRef.current?.children[selectedIndex];
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
      <div className="border border-border/50 bg-popover p-4 text-sm text-popover-foreground/60 shadow-md">
        No profiles found
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      className="max-h-[300px] w-[320px] overflow-y-auto border border-border/50 bg-popover text-popover-foreground shadow-md"
    >
      {items.map((item, index) => (
        <button
          key={item.pubkey}
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => command(item)}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
            index === selectedIndex ? "bg-muted/60" : "hover:bg-muted/60"
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              <UserName pubkey={item.pubkey} />
            </div>
            {item.nip05 && (
              <div className="truncate text-xs text-popover-foreground/60">
                {item.nip05}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
});

ProfileSuggestionList.displayName = "ProfileSuggestionList";
