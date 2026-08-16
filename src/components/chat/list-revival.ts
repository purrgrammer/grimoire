/**
 * Bringing back a timeline that mounted into a container that was not there.
 *
 * `initialTopMostItemIndex` is what opens a channel at its newest message, and
 * react-virtuoso implements it by keeping the item list `visibility: hidden`
 * until that initial scroll reaches its final location. Reaching it needs a
 * measurement, and a measurement needs a laid-out container inside a document
 * that is painting. Mount before either is true — a mosaic tile mid-split, a
 * workspace that was not on screen, a tab the browser had stopped rendering —
 * and the scroll never lands. Nothing retries it. The list stays hidden with
 * zero rows for as long as the window is open: the blank timeline.
 *
 * Confirmed against react-virtuoso 4.18.11 with the viewer's exact prop set: a
 * list mounted without frames renders only its Header, `visibility: hidden`,
 * zero children, while a list WITHOUT `initialTopMostItemIndex` renders its
 * rows in the same conditions. The prop is the trigger, and dropping it is not
 * the fix — it is the thing that makes a channel open where the reader left it.
 *
 * So the list gets remounted instead. A fresh mount re-runs the initial anchor
 * against the container that exists by then, which is the same answer the
 * reader would get by closing the window and opening it again.
 */

/** How long a timeline may hold data while rendering nothing before it is revived. */
export const REVIVE_AFTER_MS = 1200;

/** How many times one conversation may be revived before we stop trying. */
export const MAX_REVIVALS = 3;

/**
 * Whether a list showing `rendered` rows out of `dataLength` is stuck.
 *
 * Capped: a list that renders nothing for some OTHER reason must not remount
 * forever, and each remount costs the reader a repaint. Three is enough for the
 * layout races this exists for — those resolve on the first retry — and small
 * enough that a genuine defect surfaces as a blank pane rather than a loop.
 */
export function shouldRevive(
  rendered: number,
  dataLength: number,
  revivals: number,
): boolean {
  return dataLength > 0 && rendered === 0 && revivals < MAX_REVIVALS;
}
