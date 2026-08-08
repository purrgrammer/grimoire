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
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();

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

  useEffect(() => {
    setNappletMessageRecording(windowId, true);
    setNappletTapEnabled(windowId, true);
    const read = () => setEntries(getNappletMessages(windowId));
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

  // Follow the tail, but only while the user is already at it. A napplet that
  // retries a failing call streams fast enough that unconditional autoscroll
  // pulls a row out from under the pointer before it can be expanded.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < ATTACH_SLACK_PX;
    if (atBottom) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border font-mono text-xs">
      <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wide">messages</span>
        <span>{entries.length}</span>
        <button
          type="button"
          className="ml-auto transition-colors hover:text-foreground"
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

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="p-2 text-[10px] text-muted-foreground">
            Recording from now on. ↑ is the napplet talking to grimoire, ↓ is
            grimoire answering, and a shield is a permission decision. Outbound
            messages are reported by the napplet's own document, so a
            misbehaving one could under-report them.
          </p>
        ) : (
          <ul>
            {entries.map((entry) => (
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
