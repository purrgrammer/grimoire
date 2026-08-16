import { useState } from "react";
import { CalendarSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fromDateInput, toDateInput } from "./jump-date";

/**
 * Open a channel at a date rather than at a message.
 *
 * A native `<input type="date">` rather than a calendar component: there is no
 * date picker in this UI kit, and the native one is already localized, keyboard
 * accessible, and correct about the reader's own calendar — which is the only
 * hard part here.
 *
 * Only rendered for protocols that can page backwards. A NIP-10 thread is
 * already whole, so "jump to a date" would either be a no-op or a scroll the
 * reader can do themselves.
 */
export function JumpToDate({
  onPick,
  busy,
}: {
  onPick: (timestampSecs: number) => void;
  /** A walk is already running; a second pick would fight it for the boundary. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const picked = fromDateInput(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Jump to a date"
          title="Jump to a date"
        >
          <CalendarSearch className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (picked === undefined) return;
            setOpen(false);
            onPick(picked);
          }}
        >
          <input
            type="date"
            value={value}
            // Nothing was written after today, so offering it only invites a
            // walk to the end of the history for no reason.
            max={toDateInput()}
            onChange={(e) => setValue(e.target.value)}
            className="h-7 rounded border bg-background px-2 text-xs"
            aria-label="Date to jump to"
          />
          <Button
            type="submit"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={picked === undefined || busy}
          >
            Go
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
