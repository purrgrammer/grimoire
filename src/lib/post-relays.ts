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
 *
 * ## Tagged people's inboxes (NIP-65)
 *
 * "When publishing an event, clients SHOULD … send the event to all read
 * relays of each tagged user." Each tagged person's resolved read relays
 * become rows in a second section, `recipients`. A URL that is already one
 * of the author's rows stays there and gains the inbox as a second reason;
 * a URL two people read from is one row with both. Excluded people are
 * simply not passed in, so their rows disappear while a relay shared with
 * someone still tagged stays, with the remaining reason.
 *
 * Inbox rows start checked within limits: the first
 * {@link INBOX_RELAYS_PER_RECIPIENT} of each person's list (NIP-65 asks people
 * to keep lists at 2-4) and at most {@link MAX_AUTO_INBOX_RELAYS} in total.
 * Rows past a limit, and unencrypted `ws://` relays, are listed unchecked so
 * the user can still opt in.
 */
import { normalizeRelayURL } from "@/lib/relay-url";

/** Why a relay is in the list. One row can have several. */
export type RelayOrigin =
  | { type: "own-write" }
  | { type: "fallback" }
  | { type: "manual" }
  | { type: "inbox"; pubkey: string };

export const INBOX_RELAYS_PER_RECIPIENT = 4;
export const MAX_AUTO_INBOX_RELAYS = 12;

export interface RelayRow {
  /** Normalized URL — the row's identity. */
  url: string;
  origins: RelayOrigin[];
  section: "author" | "recipients";
  /** Checked unless the user said otherwise. */
  defaultSelected: boolean;
  /** Why an inbox row is NOT checked by default. */
  notAutoSelected?: "insecure" | "limit";
}

/** A tagged person's resolved, filtered inbox relays, in their list's order. */
export interface RecipientInbox {
  pubkey: string;
  relays: readonly string[];
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
  /** Tagged (not excluded) people, in the order the note mentions them. */
  recipients?: readonly RecipientInbox[];
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

  get(url: string) {
    return this.rows.get(url);
  }

  add(
    url: string,
    origin: RelayOrigin,
    defaultSelected: boolean,
    section: RelayRow["section"] = "author",
  ): RelayRow | undefined {
    const normalized = tryNormalizeRelay(url);
    if (!normalized) return undefined;
    const existing = this.rows.get(normalized);
    if (existing) {
      if (!existing.origins.some((o) => sameOrigin(o, origin)))
        existing.origins.push(origin);
      existing.defaultSelected ||= defaultSelected;
      return existing;
    }
    const row: RelayRow = {
      url: normalized,
      origins: [origin],
      section,
      defaultSelected,
    };
    this.rows.set(normalized, row);
    return row;
  }

  build(): RelayRow[] {
    return [...this.rows.values()];
  }
}

function sameOrigin(a: RelayOrigin, b: RelayOrigin): boolean {
  if (a.type === "inbox" && b.type === "inbox") return a.pubkey === b.pubkey;
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

  let autoSelected = 0;
  for (const recipient of input.recipients ?? []) {
    const origin: RelayOrigin = { type: "inbox", pubkey: recipient.pubkey };
    recipient.relays.forEach((url, index) => {
      const normalized = tryNormalizeRelay(url);
      if (!normalized) return;
      const existing = builder.get(normalized);
      if (existing) {
        // Already listed (the author's, someone else's inbox, or added by
        // hand): one row, one more reason.
        builder.add(normalized, origin, false);
        if (existing.section === "recipients" && !existing.defaultSelected) {
          const reason = autoReason(normalized, index, autoSelected);
          if (!reason) {
            existing.defaultSelected = true;
            existing.notAutoSelected = undefined;
            autoSelected++;
          }
        }
        return;
      }
      const reason = autoReason(normalized, index, autoSelected);
      const row = builder.add(normalized, origin, !reason, "recipients");
      if (row && reason) row.notAutoSelected = reason;
      if (!reason) autoSelected++;
    });
  }

  const rows = builder.build();
  return [
    ...rows.filter((r) => r.section === "author"),
    ...rows.filter((r) => r.section === "recipients"),
  ];
}

function autoReason(
  url: string,
  indexInList: number,
  autoSelectedSoFar: number,
): RelayRow["notAutoSelected"] {
  if (url.startsWith("ws://")) return "insecure";
  if (indexInList >= INBOX_RELAYS_PER_RECIPIENT) return "limit";
  if (autoSelectedSoFar >= MAX_AUTO_INBOX_RELAYS) return "limit";
  return undefined;
}

/** Pubkeys whose inbox a row is, in order. */
export function inboxPubkeys(row: RelayRow): string[] {
  return row.origins.flatMap((o) => (o.type === "inbox" ? [o.pubkey] : []));
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

export interface RecipientDeliverySummary {
  /** At least one of their selected inbox relays answered OK. */
  accepted: string[];
  /** Inbox relays were selected, none answered OK. */
  rejected: string[];
  /** No inbox relay of theirs was in the publish. */
  noInboxSelected: string[];
}

/**
 * Per tagged person, what the relays said — not whether they "received" it.
 * An OK from a relay only means that relay stored the event.
 */
export function summarizeRecipientDelivery(
  tagged: readonly string[],
  rows: readonly RelayRow[],
  published: readonly string[],
  successful: readonly string[],
): RecipientDeliverySummary {
  const publishedSet = new Set(published);
  const ok = new Set(successful);
  const summary: RecipientDeliverySummary = {
    accepted: [],
    rejected: [],
    noInboxSelected: [],
  };
  for (const pubkey of tagged) {
    const theirs = rows
      .filter(
        (r) => publishedSet.has(r.url) && inboxPubkeys(r).includes(pubkey),
      )
      .map((r) => r.url);
    if (theirs.length === 0) summary.noInboxSelected.push(pubkey);
    else if (theirs.some((url) => ok.has(url))) summary.accepted.push(pubkey);
    else summary.rejected.push(pubkey);
  }
  return summary;
}
