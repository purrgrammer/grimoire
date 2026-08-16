/**
 * Local message search — the filter model (CORD-03).
 *
 * Concord chat is sealed to a per-channel stream key, so there is no NIP-50 to
 * fall back on: no relay can read these messages, let alone index them. The
 * decrypted rumor store on this device is the entire searchable corpus, and
 * that is what makes search Concord-only for now — NIP-29 messages live in the
 * EventStore and have no local plaintext mirror to scan.
 *
 * Ported from armada `bc19d1f` (`src/concord-v2/lib/search.ts`) minus the media
 * and author facets: the media predicate needs a URL/extension module grimoire
 * does not have, and the author facet layers trivially over the folded messages
 * later. What IS ported verbatim are its measured constants below — armada is
 * the only place this scan has ever run against a real community.
 */

import { KIND_COMMENT, KIND_MESSAGE, KIND_POLL } from "@/lib/concord/kinds";

/**
 * The kinds whose content a person would expect to find by typing words: chat
 * messages, NIP-22 thread comments, and polls (whose question is their body).
 * A reaction or a delete carries no prose, and an edit's text is folded into
 * the message it edits before the predicate ever runs.
 */
export const SEARCHABLE_KINDS: readonly number[] = [
  KIND_MESSAGE,
  KIND_POLL,
  KIND_COMMENT,
];

/**
 * Upper bound on the rows one channel contributes to a search.
 *
 * armada's number, and it means more here than it did there. Its scan cap
 * bounded fold cost only, because its store filter was index-backed and it read
 * the whole window anyway. Grimoire's `queryChannelRumors` walks the
 * `[communityId+channel+created_at]` index backwards and STOPS once this many
 * row-kind rows are collected, so the cap bounds the read as well — the deep
 * end of a long channel is never touched.
 *
 * What it costs: a match older than the newest 5000 rows of its channel is
 * invisible. That is the same horizon the timeline has, deepened.
 */
export const SEARCH_SCAN_LIMIT = 5000;

/** How many hits are returned before the merge stops. armada's number. */
export const SEARCH_RESULT_LIMIT = 100;

/** How long the typing must pause before a scan starts, in ms. armada's number. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The shortest query that runs at all — one letter would match everything. */
export const SEARCH_MIN_QUERY = 2;

/**
 * What to search for, and where.
 *
 * `channelIds` empty means every channel the caller can open. It is a scope,
 * not a search: narrowing to a channel with no text typed must not dump that
 * channel's whole history into the results pane.
 */
export interface ConcordSearchFilters {
  query: string;
  /** Channel idHex allow-list; empty = every channel in scope. */
  channelIds: string[];
}

export const EMPTY_SEARCH_FILTERS: ConcordSearchFilters = {
  query: "",
  channelIds: [],
};

/** Whether these filters are a search — i.e. whether results replace the timeline. */
export function searchIsActive(filters: ConcordSearchFilters): boolean {
  return filters.query.trim().length >= SEARCH_MIN_QUERY;
}

/** The normalized needle a scan matches with, or "" when there is nothing to run. */
export function searchNeedle(filters: ConcordSearchFilters): string {
  return searchIsActive(filters) ? filters.query.trim().toLowerCase() : "";
}

/** Whether one message's text matches. Case-insensitive substring, as armada. */
export function contentMatches(content: string, needle: string): boolean {
  return needle.length > 0 && content.toLowerCase().includes(needle);
}
