/**
 * Per-Relay Filter Chunking (Outbox-Aware REQ Splitting)
 *
 * Splits filters so each relay only receives the pubkeys relevant to it,
 * based on NIP-65 relay selection reasoning.
 *
 * - `authors` → outbox relays (writers): only send author pubkeys to relays where they write
 * - `#p` → inbox relays (readers): only send tagged pubkeys to relays where they read
 *
 * When both `authors` and `#p` are present:
 * - Outbox relays (selected for writers) get their chunked authors + full #p
 * - Inbox relays (selected for readers) get full authors + their chunked #p
 * - A relay selected for both gets chunked authors + chunked #p
 *
 * Unassigned pubkeys (no kind:10002 relay list) go to ALL relays.
 * Fallback relays always get the full unmodified filter.
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

  // Collect all assigned writers and readers across non-fallback reasoning
  const allAssignedWriters = new Set<string>();
  const allAssignedReaders = new Set<string>();
  for (const r of reasoning) {
    if (!r.isFallback) {
      for (const w of r.writers) allAssignedWriters.add(w);
      for (const rd of r.readers) allAssignedReaders.add(rd);
    }
  }

  const result: Record<string, Filter[]> = {};

  for (const filter of filterArray) {
    const originalAuthors = filter.authors;
    const originalPTags = filter["#p"];
    const hasAuthors = !!originalAuthors?.length;
    const hasPTags = !!originalPTags?.length;

    // Nothing to chunk if no pubkey-based fields
    if (!hasAuthors && !hasPTags) continue;

    // Unassigned pubkeys go to ALL relays
    const unassignedAuthors = hasAuthors
      ? originalAuthors.filter((a) => !allAssignedWriters.has(a))
      : [];
    const unassignedPTags = hasPTags
      ? originalPTags.filter((p) => !allAssignedReaders.has(p))
      : [];

    // Build base filter (everything except authors and #p)
    const base: Filter = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key !== "authors" && key !== "#p") {
        (base as Record<string, unknown>)[key] = value;
      }
    }

    // Pre-compute sets for intersection checks (constant across relays)
    const authorSet = hasAuthors ? new Set(originalAuthors) : undefined;
    const pTagSet = hasPTags ? new Set(originalPTags) : undefined;

    for (const r of reasoning) {
      // Fallback relays get the full original filter
      if (r.isFallback) {
        if (!result[r.relay]) result[r.relay] = [];
        result[r.relay].push(filter);
        continue;
      }

      // Find assigned writers/readers for this relay that overlap with the filter
      const relayWriters = authorSet
        ? r.writers.filter((w) => authorSet.has(w))
        : [];
      const relayReaders = pTagSet
        ? r.readers.filter((rd) => pTagSet.has(rd))
        : [];

      // "Selected for" means the relay has assigned (non-fallback) writers/readers
      // Unassigned pubkeys piggyback but don't make a relay count as selected
      const selectedForWriters = relayWriters.length > 0;
      const selectedForReaders = relayReaders.length > 0;

      // Skip relay if it has no assigned pubkeys for this filter
      if (!selectedForWriters && !selectedForReaders) continue;

      // Build chunked lists: assigned + unassigned
      const chunkedAuthors = hasAuthors
        ? [...new Set([...relayWriters, ...unassignedAuthors])]
        : undefined;
      const chunkedPTags = hasPTags
        ? [...new Set([...relayReaders, ...unassignedPTags])]
        : undefined;

      const chunkedFilter: Filter = { ...base };

      if (hasAuthors && hasPTags) {
        // Both present:
        // - Outbox relay (writers) → chunked authors + full #p
        // - Inbox relay (readers) → full authors + chunked #p
        // - Both → chunked authors + chunked #p
        chunkedFilter.authors = selectedForWriters
          ? chunkedAuthors!
          : originalAuthors;
        chunkedFilter["#p"] = selectedForReaders
          ? chunkedPTags!
          : originalPTags;
      } else if (hasAuthors) {
        chunkedFilter.authors = chunkedAuthors!;
      } else {
        chunkedFilter["#p"] = chunkedPTags!;
      }

      if (!result[r.relay]) result[r.relay] = [];
      result[r.relay].push(chunkedFilter);
    }
  }

  return result;
}
