/**
 * Per-Relay Filter Chunking (Outbox-Aware REQ Splitting)
 *
 * Splits filters so each relay only receives the authors relevant to it,
 * based on NIP-65 relay selection reasoning.
 *
 * Only `authors` are chunked (by outbox/write relays). All other filter
 * fields — including `#p` — are passed through unchanged to every relay.
 * `#p` is a content filter ("find events tagging these pubkeys"), not a
 * routing signal, so it belongs on all relays.
 */

import type { Filter } from "nostr-tools";
import type { RelaySelectionReasoning } from "@/types/relay-selection";

/**
 * Build per-relay chunked filters from relay selection reasoning.
 *
 * Returns a plain object (not Map) so useStableValue (JSON.stringify) works.
 */
export function chunkFiltersByRelay(
  filters: Filter | Filter[],
  reasoning: RelaySelectionReasoning[],
): Record<string, Filter[]> {
  if (!reasoning.length) return {};

  const filterArray = Array.isArray(filters) ? filters : [filters];

  // Collect all assigned writers across non-fallback reasoning entries
  const allAssignedWriters = new Set<string>();
  for (const r of reasoning) {
    if (!r.isFallback) {
      for (const w of r.writers) allAssignedWriters.add(w);
    }
  }

  const result: Record<string, Filter[]> = {};

  for (const filter of filterArray) {
    const originalAuthors = filter.authors;

    // If filter has no authors, nothing to chunk
    if (!originalAuthors?.length) continue;

    // Find unassigned authors (no kind:10002) — these go to ALL relays
    const unassignedAuthors = originalAuthors.filter(
      (a) => !allAssignedWriters.has(a),
    );

    // Build base filter (everything except authors)
    const base: Filter = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key !== "authors") {
        (base as Record<string, unknown>)[key] = value;
      }
    }

    for (const r of reasoning) {
      // Fallback relays get the full original filter
      if (r.isFallback) {
        if (!result[r.relay]) result[r.relay] = [];
        result[r.relay].push(filter);
        continue;
      }

      // Build chunked authors: reasoning writers that overlap with filter authors + unassigned
      const authorSet = new Set(originalAuthors);
      const relayAuthors = r.writers.filter((w) => authorSet.has(w));
      const chunkedAuthors = [
        ...new Set([...relayAuthors, ...unassignedAuthors]),
      ];

      // If no authors for this relay, skip it
      if (chunkedAuthors.length === 0) continue;

      const chunkedFilter: Filter = { ...base, authors: chunkedAuthors };

      if (!result[r.relay]) result[r.relay] = [];
      result[r.relay].push(chunkedFilter);
    }
  }

  return result;
}
