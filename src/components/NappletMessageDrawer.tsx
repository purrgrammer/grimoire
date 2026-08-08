import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ShieldCheck, ShieldX, Trash2 } from "lucide-react";

import { useLocale } from "@/hooks/useLocale";
import {
  subscribeNappletMessages,
  getNappletMessages,
  clearNappletMessages,
  setNappletMessageRecording,
  type NappletMessageEntry,
} from "@/services/napplet-messages";
import { setNappletTapEnabled } from "@/services/napplet-host";

/** How close to the bottom still counts as "following the tail". */
const ATTACH_SLACK_PX = 24;

function DirectionIcon({ entry }: { entry: NappletMessageEntry }) {
  if (entry.direction === "acl") {
    return entry.allowed ? (
      <ShieldCheck className="size-3 shrink-0 text-muted-foreground" />
    ) : (
      <ShieldX className="size-3 shrink-0 text-destructive" />
    );
  }
  return entry.direction === "in" ? (
    <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
  ) : (
    <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
  );
}

function MessageRow({
  entry,
  clock,
}: {
  entry: NappletMessageEntry;
  clock: Intl.DateTimeFormat;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-border/30 last:border-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted/30"
        onClick={() => setOpen((prev) => !prev)}
      >
        <DirectionIcon entry={entry} />
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {clock.format(entry.at)}
        </span>
        <span
          className={`truncate ${
            entry.direction === "acl" && !entry.allowed
              ? "text-destructive"
              : "text-foreground"
          }`}
        >
          {entry.label}
        </span>
        {entry.direction === "acl" && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {entry.allowed ? "allowed" : "denied"}
          </span>
        )}
      </button>
      {open && (
        <pre className="overflow-x-auto bg-muted/20 px-2 py-1 text-[10px] leading-tight text-muted-foreground">
          {entry.payload}
        </pre>
      )}
    </li>
  );
}

/**
 * The host↔napplet traffic for one pane.
 *
 * Mounting starts recording and unmounting stops it, so a closed drawer costs
 * nothing — see `napplet-messages.ts` for why both halves are dormant by
 * default, and for why the outbound half is best-effort rather than authoritative.
 */
export function NappletMessageDrawer({
  windowId,
  onClose,
}: {
  windowId: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<NappletMessageEntry[]>([]);
  const [filter, setFilter] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();

  // A napplet streaming a timeline fills the whole buffer with `relay.event`
  // inside a second, which buries the four messages anyone is ever looking for.
  // Without this the log is unreadable on exactly the napplets worth debugging.
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      entry.label.toLowerCase().includes(needle),
    );
  }, [entries, filter]);

  // Seconds, unlike the shared `Timestamp`: a handshake and the burst behind it
  // land inside the same minute, and rows are already in arrival order.
  const clock = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    [locale],
  );

  // Scrolling away from the tail freezes the view; scrolling back resumes it.
  //
  // Recording never stops — only what is displayed is held still. Without this
  // the list is unreadable on a chatty napplet for two compounding reasons: new
  // rows push the view, and the ring dropping its oldest entries shifts every
  // row up underneath the pointer. Either one is enough to make a payload
  // impossible to open, which is the only thing a message log is for.
  // Read from the element rather than mirroring `paused` into a ref: the scroll
  // position is the truth, and a ref written during render is a lint violation
  // for a reason.
  const [paused, setPaused] = useState(false);
  const isAtTail = () => {
    const list = listRef.current;
    if (!list) return true;
    return (
      list.scrollHeight - list.scrollTop - list.clientHeight < ATTACH_SLACK_PX
    );
  };

  useEffect(() => {
    setNappletMessageRecording(windowId, true);
    setNappletTapEnabled(windowId, true);
    const read = () => {
      if (isAtTail()) setEntries(getNappletMessages(windowId));
    };
    read();
    const unsubscribe = subscribeNappletMessages(read);
    return () => {
      unsubscribe();
      setNappletTapEnabled(windowId, false);
      setNappletMessageRecording(windowId, false);
      // Recording off would otherwise leave the buffer to be re-shown, stale,
      // the next time the drawer opens.
      clearNappletMessages(windowId);
    };
  }, [windowId]);

  const onScroll = () => {
    const atTail = isAtTail();
    setPaused(!atTail);
    if (atTail) setEntries(getNappletMessages(windowId));
  };

  // Follow the tail only while attached to it.
  useEffect(() => {
    if (!paused) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [shown.length, paused]);

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border font-mono text-xs">
      <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wide">messages</span>
        <span>
          {filter.trim() ? `${shown.length}/${entries.length}` : entries.length}
        </span>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="filter"
          aria-label="Filter messages by type"
          className="min-w-0 flex-1 border-0 bg-transparent text-[10px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        {paused && (
          <span
            className="shrink-0 text-warning"
            title="Scroll to the bottom to resume"
          >
            paused
          </span>
        )}
        <button
          type="button"
          className="transition-colors hover:text-foreground"
          onClick={() => clearNappletMessages(windowId)}
          title="Clear"
          aria-label="Clear messages"
        >
          <Trash2 className="size-3" />
        </button>
        <button
          type="button"
          className="transition-colors hover:text-foreground"
          onClick={onClose}
          aria-label="Close messages"
        >
          ▾
        </button>
      </div>

      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="p-2 text-[10px] text-muted-foreground">
            {filter.trim() ? `Nothing matching "${filter.trim()}" yet. ` : ""}
            Recording from now on. ↑ is the napplet talking to grimoire, ↓ is
            grimoire answering, and a shield is a permission decision. Outbound
            messages are reported by the napplet's own document, so a
            misbehaving one could under-report them.
          </p>
        ) : (
          <ul>
            {shown.map((entry) => (
              <MessageRow key={entry.seq} entry={entry} clock={clock} />
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export default NappletMessageDrawer;
