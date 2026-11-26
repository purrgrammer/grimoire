/**
 * Which relays a `post` goes to, and why.
 *
 * The list is DERIVED, never stored: rows are recomputed from the account's
 * write relays and the relays the user added. What the user decided is kept
 * separately as overrides, one `on`/`off` per URL, and only for URLs they
 * actually toggled. A row's checkbox is `overrides[url] ?? row.defaultSelected`.
 *
 * That split is what lets late data land safely. The previous composer stored
 * the selected set itself, so the account's kind 10002 arriving after a draft
 * restore replaced it wholesale, dropping the draft's added relays and its
 * unticks. With overrides, new rows simply appear with their default and an
 * explicit choice is never reset.
 */
import { normalizeRelayURL } from "@/lib/relay-url";

/** Why a relay is in the list. One row can have several. */
export type RelayOrigin =
  { type: "own-write" } | { type: "fallback" } | { type: "manual" };

export interface RelayRow {
  /** Normalized URL — the row's identity. */
  url: string;
  origins: RelayOrigin[];
  section: "author";
  /** Checked unless the user said otherwise. */
  defaultSelected: boolean;
}

/** URL → explicit choice. Absent means "use the row's default". */
export type RelayOverrides = Readonly<Record<string, boolean>>;

export interface RelayRowsInput {
  /** The account's NIP-65 write relays. */
  ownWrite: readonly string[];
  /** Used when `ownWrite` is empty, as the composer always has. */
  fallback: readonly string[];
  /** Relays the user typed in. */
  manual: readonly string[];
}

/** Normalize, or `null` for a URL that cannot be a relay. */
export function tryNormalizeRelay(url: string): string | null {
  try {
    return normalizeRelayURL(url);
  } catch {
    return null;
  }
}

class RowBuilder {
  private rows = new Map<string, RelayRow>();

  add(url: string, origin: RelayOrigin, defaultSelected: boolean) {
    const normalized = tryNormalizeRelay(url);
    if (!normalized) return;
    const existing = this.rows.get(normalized);
    if (existing) {
      if (!existing.origins.some((o) => sameOrigin(o, origin)))
        existing.origins.push(origin);
      existing.defaultSelected ||= defaultSelected;
      return;
    }
    this.rows.set(normalized, {
      url: normalized,
      origins: [origin],
      section: "author",
      defaultSelected,
    });
  }

  build(): RelayRow[] {
    return [...this.rows.values()];
  }
}

function sameOrigin(a: RelayOrigin, b: RelayOrigin): boolean {
  return a.type === b.type;
}

/** The composer's relay rows, deduplicated by normalized URL, in display order. */
export function deriveRelayRows(input: RelayRowsInput): RelayRow[] {
  const builder = new RowBuilder();
  if (input.ownWrite.length > 0) {
    for (const url of input.ownWrite)
      builder.add(url, { type: "own-write" }, true);
  } else {
    for (const url of input.fallback)
      builder.add(url, { type: "fallback" }, true);
  }
  for (const url of input.manual) builder.add(url, { type: "manual" }, true);
  return builder.build();
}

export function isRowSelected(row: RelayRow, overrides: RelayOverrides) {
  return overrides[row.url] ?? row.defaultSelected;
}

/** Selected URLs in row order. Overrides for URLs with no row are ignored. */
export function effectiveSelection(
  rows: readonly RelayRow[],
  overrides: RelayOverrides,
): string[] {
  return rows.filter((row) => isRowSelected(row, overrides)).map((r) => r.url);
}

/** Whether any visible row differs from its default because of an override. */
export function hasActiveOverrides(
  rows: readonly RelayRow[],
  overrides: RelayOverrides,
): boolean {
  return rows.some(
    (row) => row.url in overrides && overrides[row.url] !== row.defaultSelected,
  );
}
