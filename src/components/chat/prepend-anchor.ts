/**
 * Keeping the reader's place when older messages arrive above them.
 *
 * react-virtuoso identifies a row by `firstItemIndex + arrayIndex`. Leave
 * `firstItemIndex` alone and a page of history prepended to the array renumbers
 * every row the reader is looking at, so the list holds its scroll OFFSET and
 * the view jumps backwards through the history it just fetched. Decrease it by
 * exactly how many rows appeared ABOVE the old top row and the numbering of
 * everything already on screen is unchanged, which is what makes the click feel
 * like more content arriving rather than a teleport.
 *
 * The delta is measured against a row's IDENTITY, never against array lengths.
 * A widened window does not simply prepend messages: it can add a day marker
 * that was not there before, drop one that no longer starts a day, and insert
 * the "New" divider — so `next.length - prev.length` is not the number of rows
 * that landed above the anchor, and using it puts the list off by the difference
 * permanently.
 *
 * Note what does NOT need adjusting, verified against react-virtuoso 4.18.11:
 * `scrollToIndex` and `initialTopMostItemIndex` are DATA-relative — the handle
 * clamps its argument to `[0, data.length - 1]` and `firstItemIndex` is only
 * added when computing an item's key. So no scroll call site changes, and the
 * `{ index: "LAST", align: "end" }` form that fixed the blank-channel bug stays
 * exactly as it is.
 */

/** The rows this cares about: those carrying an id it can find again. */
export type AnchorItem =
  | { type: "message"; data: { id: string } }
  | { type: "grouped-system"; data: { messageIds: string[] } }
  | { type: "day-marker"; data: string; timestamp: number }
  | { type: "unread-divider" };

/**
 * Where `firstItemIndex` starts. Large, because it only ever counts DOWN as
 * history is paged in, and react-virtuoso requires it to stay positive.
 */
export const FIRST_ITEM_INDEX_BASE = 100_000;

/** The topmost row that has an id — day markers and the divider have none. */
function firstIdentified(
  items: readonly AnchorItem[],
): { id: string; index: number } | undefined {
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.type === "message") return { id: item.data.id, index };
    if (item.type === "grouped-system" && item.data.messageIds.length > 0) {
      return { id: item.data.messageIds[0], index };
    }
  }
  return undefined;
}

/** Where that same row sits now, or -1 if this is a different timeline. */
function indexOfId(items: readonly AnchorItem[], id: string): number {
  return items.findIndex(
    (item) =>
      (item.type === "message" && item.data.id === id) ||
      (item.type === "grouped-system" && item.data.messageIds.includes(id)),
  );
}

/**
 * How many rows appeared above the previous top row — subtract this from
 * `firstItemIndex`.
 *
 * `null` means "start over": either side empty, or the old top row is gone
 * entirely, which is a different conversation or a timeline replaced rather
 * than extended. Reset rather than guess — a wrong offset is a permanently
 * mis-keyed list, while a reset costs one un-anchored repaint.
 *
 * A negative answer is possible and correct (rows removed above the anchor, as
 * a delete or an expiry can do), so the caller must handle `firstItemIndex`
 * moving back up.
 */
export function computeFirstItemIndexDelta(
  prev: readonly AnchorItem[],
  next: readonly AnchorItem[],
): number | null {
  if (prev.length === 0 || next.length === 0) return null;
  const anchor = firstIdentified(prev);
  if (!anchor) return null;
  const at = indexOfId(next, anchor.id);
  if (at === -1) return null;
  return at - anchor.index;
}
