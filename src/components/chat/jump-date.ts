/**
 * Turning a picked calendar date into the timestamp a timeline can be walked to.
 *
 * The one rule worth stating: a date the reader picks is a date in THEIR
 * calendar, so it resolves against local midnight. The obvious shortcuts —
 * `new Date(value)`, `toISOString().slice(0, 10)` — both go through UTC, which
 * lands a reader east or west of Greenwich on the wrong day for part of every
 * day. Neither appears here on purpose.
 */

/** Today, as `<input type="date">` spells it. Local, for the same reason. */
export function toDateInput(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The local midnight of a `yyyy-mm-dd` value, in unix SECONDS.
 *
 * `undefined` for anything the input can hand over that is not a real date —
 * an empty field, a partial year while typing, or the 31st of February, which
 * `Date` would silently roll forward into March rather than refuse.
 */
export function fromDateInput(value: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!parts) return undefined;
  const year = Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  const date = new Date(year, month, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return Math.floor(date.getTime() / 1000);
}
