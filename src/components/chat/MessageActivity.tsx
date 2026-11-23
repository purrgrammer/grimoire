/**
 * Who answered a message — one row under it.
 *
 *     ○ alice, bob replied                                         ⌸ 3
 *
 * Renders nothing for a message nobody replied to. Clicking opens the thread
 * pane, and clicking again while that pane shows this thread closes it.
 */

import { MessageSquare } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@/lib/chat/threads";

/** How many names are spelled out before the rest become a `+n`. */
const NAMED = 2;

export function MessageActivity({
  thread,
  unread,
  active,
  onOpenThread,
  onCloseThread,
}: {
  /** The replies folded under this message, when it has any. */
  thread?: ThreadSummary;
  /** How many of those the reader has not seen. */
  unread?: number;
  /** Whether the pane is already showing this message's thread. */
  active?: boolean;
  onOpenThread?: (rootId: string) => void;
  /** Closes it again — this row is the toggle for the pane it opened. */
  onCloseThread?: () => void;
}) {
  const names = thread ? thread.repliers : [];
  if (!thread || names.length === 0) return null;

  const named = names.slice(0, NAMED);
  const rest = names.length - named.length;

  const onClick = () => {
    // A TOGGLE when the pane is already showing this one. The pane's own close
    // sits directly under the window's close in the same column, one row apart,
    // and a reader aiming for one and hitting the other loses the whole window.
    // The row they opened it from is the unmissable way back.
    if (active && onCloseThread) return onCloseThread();
    onOpenThread?.(thread.rootId);
  };

  const title = `${thread.replyIds.length} ${thread.replyIds.length === 1 ? "reply" : "replies"}${unread ? `, ${unread} unread` : ""}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-expanded={active}
      // Fixed height and no wrapping: this grows under a message already on
      // screen, so a row that changed height when a name or a figure arrived
      // would shift the timeline under the reader.
      className={cn(
        "mt-1 flex h-5 w-full max-w-full items-center gap-1.5 whitespace-nowrap rounded px-1 text-left text-xs hover:bg-muted/50",
        active && "bg-muted/50",
      )}
    >
      <span className="flex h-2 w-2 shrink-0 items-center justify-center">
        <span
          className={cn(
            "h-2 w-2 rounded-full border",
            unread ? "border-primary bg-primary/30" : "border-muted-foreground",
          )}
        />
      </span>
      {/* `UserName`, not a flat string: it carries custom emoji in a display
          name and the member and supporter badges — the same name the message
          above it draws. A span with its own stopPropagation, so it opens a
          profile without also opening the thread, and no interactive element
          nests inside this button. */}
      <span className="flex min-w-0 items-center gap-1 truncate">
        {named.map((pubkey, index) => (
          <span key={pubkey} className="flex min-w-0 items-center">
            <UserName pubkey={pubkey} className="text-xs" />
            {index < named.length - 1 && ","}
          </span>
        ))}
        {rest > 0 && (
          <span className="shrink-0 text-muted-foreground">+{rest}</span>
        )}
      </span>
      <span className="shrink-0 text-muted-foreground">replied</span>
      <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 font-mono text-[10px]",
            unread ? "text-primary" : "text-muted-foreground/70",
          )}
        >
          <MessageSquare className="h-2.5 w-2.5" />
          {thread.replyIds.length}
        </span>
      </span>
    </button>
  );
}
