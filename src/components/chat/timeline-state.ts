/**
 * What the timeline pane should be showing: the list, a wait, or nothing.
 *
 * The three-way choice used to be inline, and it got the third case wrong.
 * `usePaintedContainer` holds the virtualized list back until the container
 * can be measured in a painting document — a mosaic tile mid-split, a
 * workspace that is not on screen, a tab the browser stopped rendering — and
 * the fallback behind that gate said "No messages yet. Start the
 * conversation!" A conversation the reader has been having for months reads as
 * empty, with a live composer under it, and the reader has no way to tell that
 * from the truth.
 *
 * A gate that is still shut is a WAIT. Only a timeline that has arrived, with
 * nothing in it, is empty.
 */
export type TimelineState = "list" | "waiting" | "empty" | "incomplete";

export function timelineState({
  messages,
  rows,
  painted,
  incomplete = false,
}: {
  /** Undefined until the adapter has emitted — adapters do not emit until EOSE. */
  messages: unknown[] | undefined;
  /** Rows after day markers and the unread divider have been folded in. */
  rows: number;
  /** Whether the container has been measured in a painting document. */
  painted: boolean;
  /** A relay needs auth, timed out, or refused the read. */
  incomplete?: boolean;
}): TimelineState {
  if (rows > 0) return painted ? "list" : "waiting";
  if (incomplete) return "incomplete";
  return messages === undefined ? "waiting" : "empty";
}
