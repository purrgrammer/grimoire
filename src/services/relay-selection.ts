/**
 * NIP-65 Relay Selection Service
 *
 * Intelligently selects relays for Nostr queries using the NIP-65 outbox model:
 * - Query authors' WRITE relays (where they publish content)
 * - Query mentioned users' READ relays (where they check mentions)
 * - Optimize relay selection to minimize connections while maximizing coverage
 *
 * See: https://github.com/nostr-protocol/nips/blob/master/65.md
 */

import type { NostrEvent } from "nostr-tools";
import type { Filter as NostrFilter } from "nostr-tools";
import type { ProfilePointer } from "nostr-tools/nip19";
import { firstValueFrom, timeout as rxTimeout, of } from "rxjs";
import { catchError } from "rxjs/operators";
import type { IEventStore } from "applesauce-core/event-store";
import {
  getInboxes,
  getOutboxes,
  mergeRelaySets,
} from "applesauce-core/helpers";
import { selectOptimalRelays } from "applesauce-core/helpers";
import { addressLoader, AGGREGATOR_RELAYS } from "./loaders";
import { normalizeRelayURL } from "@/lib/relay-url";
import liveness from "./relay-liveness";
import relayListCache from "./relay-list-cache";
import type {
  RelaySelectionResult,
  RelaySelectionReasoning,
  RelaySelectionOptions,
} from "@/types/relay-selection";

/**
 * Fetches a kind:10002 relay list event for a pubkey with timeout
 *
 * @param pubkey - Hex pubkey to fetch relay list for
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise that resolves when fetch completes or times out
 */
async function fetchRelayList(
  pubkey: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await firstValueFrom(
      addressLoader({ kind: 10002, pubkey, identifier: "" }).pipe(
        rxTimeout(timeoutMs),
        catchError(() => of(null)),
      ),
    );
  } catch (err) {
    // Timeout or error - continue with fallback
    console.debug(
      `[RelaySelection] Failed to fetch relay list for ${pubkey.slice(0, 8)}`,
      err,
    );
  }
}

/**
 * Sanitizes relay URLs by removing localhost and TOR relays
 *
 * @param relays - Array of relay URLs
 * @returns Filtered array without localhost or TOR relays
 */
function sanitizeRelays(relays: string[]): string[] {
  return relays.filter((url) => {
    // Remove localhost relays (ws://localhost, ws://127.0.0.1, ws://[::1])
    if (/^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
      console.debug(`[RelaySelection] Filtered localhost relay: ${url}`);
      return false;
    }

    // Remove TOR relays (*.onion)
    if (/\.onion/i.test(url)) {
      console.debug(`[RelaySelection] Filtered TOR relay: ${url}`);
      return false;
    }

    return true;
  });
}

/**
 * Gets outbox (write) relays for a pubkey
 * Checks cache first, falls back to EventStore
 *
 * @param eventStore - EventStore instance
 * @param pubkey - Hex pubkey
 * @returns Array of normalized relay URLs (filtered for health)
 */
async function getOutboxRelaysForPubkey(
  eventStore: IEventStore,
  pubkey: string,
): Promise<string[]> {
  try {
    // Check cache first
    const cachedRelays = await relayListCache.getOutboxRelays(pubkey);
    if (cachedRelays) {
      console.debug(
        `[RelaySelection] Using cached outbox relays for ${pubkey.slice(0, 8)} (${cachedRelays.length} relays)`,
      );
      // Apply sanity filters (remove localhost, TOR)
      const sanitized = sanitizeRelays(cachedRelays);

      // Still filter for health even if cached
      try {
        const healthy = liveness.filter(sanitized);
        if (healthy.length === 0 && sanitized.length > 0) {
          return sanitized; // Keep sanitized relays even if all unhealthy
        }
        return healthy;
      } catch {
        return sanitized;
      }
    }

    // Cache miss - get from EventStore
    const event = eventStore.getReplaceable(10002, pubkey, "") as
      | NostrEvent
      | undefined;
    if (!event) {
      console.debug(
        `[RelaySelection] No relay list found for ${pubkey.slice(0, 8)} (not in cache or store)`,
      );
      return [];
    }

    // Cache the event for next time
    relayListCache.set(event);
    console.debug(
      `[RelaySelection] Cache miss for ${pubkey.slice(0, 8)}, loaded from EventStore`,
    );

    // Parse outbox relays and normalize URLs
    const outboxes = getOutboxes(event);
    const normalized = outboxes
      .map((url) => {
        try {
          return normalizeRelayURL(url);
        } catch {
          console.warn(
            `[RelaySelection] Invalid relay URL in kind:10002: ${url}`,
          );
          return null;
        }
      })
      .filter((url): url is string => url !== null);

    // Apply sanity filters (remove localhost, TOR)
    const sanitized = sanitizeRelays(normalized);

    // Filter unhealthy relays (dead/blacklisted)
    try {
      const healthy = liveness.filter(sanitized);

      // Edge case: If all relays filtered out, keep some anyway for redundancy
      if (healthy.length === 0 && sanitized.length > 0) {
        console.debug(
          `[RelaySelection] All relays unhealthy for ${pubkey.slice(0, 8)}, keeping sanitized relays`,
        );
        return sanitized;
      }

      return healthy;
    } catch (err) {
      console.warn(
        `[RelaySelection] Liveness filtering failed, using sanitized relays:`,
        err,
      );
      return sanitized;
    }
  } catch (err) {
    console.warn(
      `[RelaySelection] Error getting outbox relays for ${pubkey.slice(0, 8)}:`,
      err,
    );
    return [];
  }
}

/**
 * Gets inbox (read) relays for a pubkey
 * Checks cache first, falls back to EventStore
 *
 * @param eventStore - EventStore instance
 * @param pubkey - Hex pubkey
 * @returns Array of normalized relay URLs (filtered for health)
 */
async function getInboxRelaysForPubkey(
  eventStore: IEventStore,
  pubkey: string,
): Promise<string[]> {
  try {
    // Check cache first
    const cachedRelays = await relayListCache.getInboxRelays(pubkey);
    if (cachedRelays) {
      console.debug(
        `[RelaySelection] Using cached inbox relays for ${pubkey.slice(0, 8)} (${cachedRelays.length} relays)`,
      );
      // Apply sanity filters (remove localhost, TOR)
      const sanitized = sanitizeRelays(cachedRelays);

      // Still filter for health even if cached
      try {
        const healthy = liveness.filter(sanitized);
        if (healthy.length === 0 && sanitized.length > 0) {
          return sanitized; // Keep sanitized relays even if all unhealthy
        }
        return healthy;
      } catch {
        return sanitized;
      }
    }

    // Cache miss - get from EventStore
    const event = eventStore.getReplaceable(10002, pubkey, "") as
      | NostrEvent
      | undefined;
    if (!event) {
      console.debug(
        `[RelaySelection] No relay list found for ${pubkey.slice(0, 8)} (not in cache or store)`,
      );
      return [];
    }

    // Cache the event for next time
    relayListCache.set(event);
    console.debug(
      `[RelaySelection] Cache miss for ${pubkey.slice(0, 8)}, loaded from EventStore`,
    );

    // Parse inbox relays and normalize URLs
    const inboxes = getInboxes(event);
    const normalized = inboxes
      .map((url) => {
        try {
          return normalizeRelayURL(url);
        } catch {
          console.warn(
            `[RelaySelection] Invalid relay URL in kind:10002: ${url}`,
          );
          return null;
        }
      })
      .filter((url): url is string => url !== null);

    // Apply sanity filters (remove localhost, TOR)
    const sanitized = sanitizeRelays(normalized);

    // Filter unhealthy relays (dead/blacklisted)
    try {
      const healthy = liveness.filter(sanitized);

      // Edge case: If all relays filtered out, keep some anyway for redundancy
      if (healthy.length === 0 && sanitized.length > 0) {
        console.debug(
          `[RelaySelection] All relays unhealthy for ${pubkey.slice(0, 8)}, keeping sanitized relays`,
        );
        return sanitized;
      }

      return healthy;
    } catch (err) {
      console.warn(
        `[RelaySelection] Liveness filtering failed, using sanitized relays:`,
        err,
      );
      return sanitized;
    }
  } catch (err) {
    console.warn(
      `[RelaySelection] Error getting inbox relays for ${pubkey.slice(0, 8)}:`,
      err,
    );
    return [];
  }
}

/**
 * Builds reasoning array explaining why relays were selected
 *
 * @param selectedPointers - ProfilePointers after optimization
 * @param authorPointers - Original author pointers (for type classification)
 * @param pTagPointers - Original p-tag pointers (for type classification)
 * @returns Array of reasoning objects
 */
function buildReasoning(
  selectedPointers: ProfilePointer[],
  authorPointers: ProfilePointer[],
  pTagPointers: ProfilePointer[],
): RelaySelectionReasoning[] {
  // Group pubkeys by relay, tracking writers and readers separately
  const relayMap = new Map<
    string,
    { writers: Set<string>; readers: Set<string> }
  >();

  for (const pointer of selectedPointers) {
    const isAuthor = authorPointers.some((p) => p.pubkey === pointer.pubkey);
    const isPTag = pTagPointers.some((p) => p.pubkey === pointer.pubkey);

    for (const relay of pointer.relays || []) {
      let entry = relayMap.get(relay);
      if (!entry) {
        entry = { writers: new Set(), readers: new Set() };
        relayMap.set(relay, entry);
      }

      // Add to appropriate set(s) - a relay can be both!
      if (isAuthor) {
        entry.writers.add(pointer.pubkey);
      }
      if (isPTag) {
        entry.readers.add(pointer.pubkey);
      }
    }
  }

  // Convert to reasoning array
  return Array.from(relayMap.entries()).map(
    ([relay, { writers, readers }]) => ({
      relay,
      writers: Array.from(writers),
      readers: Array.from(readers),
      isFallback: false,
    }),
  );
}

/**
 * Creates a fallback result when no pubkeys or all fetches failed
 *
 * @param fallbackRelays - Relay URLs to use as fallback
 * @returns RelaySelectionResult with fallback relays
 */
function createFallbackResult(fallbackRelays: string[]): RelaySelectionResult {
  return {
    relays: fallbackRelays,
    reasoning: fallbackRelays.map((relay) => ({
      relay,
      writers: [],
      readers: [],
      isFallback: true,
    })),
    isOptimized: false,
  };
}

/**
 * Selects optimal relays for a Nostr filter using NIP-65 outbox model
 *
 * @param eventStore - EventStore instance for reading cached relay lists
 * @param filter - Nostr filter to select relays for
 * @param options - Configuration options
 * @returns Promise resolving to relay selection result
 *
 * @example
 * ```typescript
 * // Query authors' write relays
 * const result = await selectRelaysForFilter(eventStore, {
 *   authors: ["abc123..."],
 *   kinds: [1]
 * });
 *
 * // Query mentioned users' read relays
 * const result = await selectRelaysForFilter(eventStore, {
 *   "#p": ["xyz789..."],
 *   kinds: [1]
 * });
 * ```
 */
export async function selectRelaysForFilter(
  eventStore: IEventStore,
  filter: NostrFilter,
  options: RelaySelectionOptions = {},
): Promise<RelaySelectionResult> {
  const {
    maxRelays = 42,
    maxRelaysPerUser = 6,
    fallbackRelays = AGGREGATOR_RELAYS,
    timeout = 1000,
  } = options;

  // Extract pubkeys from filter
  const authors = filter.authors || [];
  const pTags = filter["#p"] || [];

  // If no pubkeys, return fallback immediately
  if (authors.length === 0 && pTags.length === 0) {
    console.debug(
      "[RelaySelection] No authors or #p tags, using fallback relays",
    );
    return createFallbackResult(fallbackRelays);
  }

  console.debug(
    `[RelaySelection] Selecting relays for ${authors.length} authors, ${pTags.length} p-tags`,
  );

  // Fetch kind:10002 for all pubkeys with timeout
  // This triggers fetches but doesn't block on slow relays
  await Promise.all([
    ...authors.map((pk) => fetchRelayList(pk, timeout)),
    ...pTags.map((pk) => fetchRelayList(pk, timeout)),
  ]);

  // Read from cache/EventStore and build ProfilePointers
  // Take up to maxRelaysPerUser for each user to ensure redundancy
  const authorPointers: ProfilePointer[] = await Promise.all(
    authors.map(async (pubkey) => {
      const relays = await getOutboxRelaysForPubkey(eventStore, pubkey);
      return {
        pubkey,
        relays: relays.slice(0, maxRelaysPerUser),
      };
    }),
  );

  const pTagPointers: ProfilePointer[] = await Promise.all(
    pTags.map(async (pubkey) => {
      const relays = await getInboxRelaysForPubkey(eventStore, pubkey);
      return {
        pubkey,
        relays: relays.slice(0, maxRelaysPerUser),
      };
    }),
  );

  // Add fallbacks for users with no relays
  const processedAuthorPointers = authorPointers.map((pointer) => ({
    ...pointer,
    relays:
      pointer.relays && pointer.relays.length > 0
        ? pointer.relays
        : fallbackRelays,
  }));

  const processedPTagPointers = pTagPointers.map((pointer) => ({
    ...pointer,
    relays:
      pointer.relays && pointer.relays.length > 0
        ? pointer.relays
        : fallbackRelays,
  }));

  const allPointers = [...processedAuthorPointers, ...processedPTagPointers];
  const fallbackCount =
    authorPointers.filter((p) => !p.relays || p.relays.length === 0).length +
    pTagPointers.filter((p) => !p.relays || p.relays.length === 0).length;

  if (fallbackCount > 0) {
    console.debug(
      `[RelaySelection] ${fallbackCount} users have no relay list, using fallback relays`,
    );
  }

  // If all users have no relays, return fallback result
  if (fallbackCount === allPointers.length) {
    console.debug(
      "[RelaySelection] All users have no relay lists, using fallback",
    );
    return createFallbackResult(fallbackRelays);
  }

  // When both authors and p-tags exist, select from each group separately
  // to ensure we maintain diversity (write relays from authors, read relays from p-tags)
  let selectedPointers: ProfilePointer[];

  if (authors.length === 1 && pTags.length === 1) {
    // Special case: single author + single p-tag
    // Use ALL outbox relays from author + ALL inbox relays from p-tag for complete coverage
    selectedPointers = [...processedAuthorPointers, ...processedPTagPointers];

    console.debug(
      `[RelaySelection] Single author + single p-tag case: using all ${processedAuthorPointers[0].relays?.length || 0} outbox + ${processedPTagPointers[0].relays?.length || 0} inbox relays`,
    );
  } else if (authors.length === 1 && pTags.length === 0) {
    // Special case: single author (common for "notes from X" queries)
    // Use ALL their outbox relays for complete content coverage
    selectedPointers = processedAuthorPointers;

    console.debug(
      `[RelaySelection] Single author case: using all ${selectedPointers[0].relays?.length || 0} outbox relays`,
    );
  } else if (authors.length === 0 && pTags.length === 1) {
    // Special case: single p-tagged user (common for "-p $me" queries)
    // Use ALL their inbox relays for complete mention coverage
    selectedPointers = processedPTagPointers;

    console.debug(
      `[RelaySelection] Single p-tag case: using all ${selectedPointers[0].relays?.length || 0} inbox relays`,
    );
  } else if (authors.length > 0 && pTags.length > 0) {
    // Multiple authors/p-tags: split relay budget proportionally
    const totalUsers = authors.length + pTags.length;
    const authorRelayBudget = Math.max(
      3, // minimum 3 relays per group
      Math.floor((authors.length / totalUsers) * maxRelays),
    );
    const pTagRelayBudget = Math.max(
      3, // minimum 3 relays per group
      maxRelays - authorRelayBudget,
    );

    // Select from each group independently
    const selectedAuthors = selectOptimalRelays(processedAuthorPointers, {
      maxConnections: authorRelayBudget,
      maxRelaysPerUser,
    });

    const selectedPTags = selectOptimalRelays(processedPTagPointers, {
      maxConnections: pTagRelayBudget,
      maxRelaysPerUser,
    });

    selectedPointers = [...selectedAuthors, ...selectedPTags];

    console.debug(
      `[RelaySelection] Selected ${selectedAuthors.flatMap((p) => p.relays).length} write relays from ${authors.length} authors, ` +
        `${selectedPTags.flatMap((p) => p.relays).length} read relays from ${pTags.length} p-tags`,
    );
  } else {
    // Optimize relay selection for efficient coverage
    selectedPointers = selectOptimalRelays(allPointers, {
      maxConnections: maxRelays,
      maxRelaysPerUser,
    });

    console.debug(
      `[RelaySelection] Selected relays from ${allPointers.length} ${allPointers.length === 1 ? "user" : "users"}`,
    );
  }

  // Extract unique relays (mergeRelaySets handles deduplication and normalization)
  const relays = mergeRelaySets(...selectedPointers.map((p) => p.relays || []));

  console.debug(`[RelaySelection] Total: ${relays.length} unique relays`);

  // Build reasoning
  const reasoning = buildReasoning(
    selectedPointers,
    authorPointers,
    pTagPointers,
  );

  return {
    relays,
    reasoning,
    isOptimized: true,
  };
}

/** Maximum number of relays for interactions */
const MAX_INTERACTION_RELAYS = 10;

/** Minimum relays per party for redundancy */
const MIN_RELAYS_PER_PARTY = 3;

/**
 * Selects optimal relays for publishing an interaction event (reaction, reply, etc.)
 *
 * Strategy per NIP-65:
 * - Author's outbox relays: where we publish our content
 * - Target's inbox relays: where the target reads mentions/interactions
 * - Fallback aggregators if neither has preferences
 *
 * @param authorPubkey - Pubkey of the interaction author (person reacting/replying)
 * @param targetPubkey - Pubkey of the target (person being reacted to/replied to)
 * @returns Promise resolving to array of relay URLs
 */
export async function selectRelaysForInteraction(
  authorPubkey: string,
  targetPubkey: string,
): Promise<string[]> {
  // Fetch relays in parallel
  const [authorOutbox, targetInbox] = await Promise.all([
    relayListCache.getOutboxRelays(authorPubkey),
    relayListCache.getInboxRelays(targetPubkey),
  ]);

  const outboxRelays = authorOutbox || [];
  const inboxRelays = targetInbox || [];

  // Build relay list with priority ordering using mergeRelaySets
  // Priority: first N from each party, then remaining from each
  // mergeRelaySets handles deduplication and normalization
  const relays = mergeRelaySets(
    outboxRelays.slice(0, MIN_RELAYS_PER_PARTY),
    inboxRelays.slice(0, MIN_RELAYS_PER_PARTY),
    outboxRelays.slice(MIN_RELAYS_PER_PARTY),
    inboxRelays.slice(MIN_RELAYS_PER_PARTY),
  ).slice(0, MAX_INTERACTION_RELAYS);

  // Fallback to aggregator relays if empty
  if (relays.length === 0) {
    return AGGREGATOR_RELAYS.slice(0, MAX_INTERACTION_RELAYS);
  }

  return relays;
}
