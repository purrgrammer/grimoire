/**
 * React hook for accessing the Event Log
 *
 * Provides reactive access to relay operation logs with filtering capabilities.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import eventLog, {
  type LogEntry,
  type EventLogType,
} from "@/services/event-log";

export interface UseEventLogOptions {
  /** Filter by event type(s) */
  types?: EventLogType[];
  /** Filter by relay URL */
  relay?: string;
  /** Maximum entries to return */
  limit?: number;
}

export interface UseEventLogResult {
  /** Filtered log entries */
  entries: LogEntry[];
  /** Clear all log entries */
  clear: () => void;
  /** Retry failed relays for a publish entry */
  retryFailedRelays: (entryId: string) => Promise<void>;
  /** Retry a single relay for a publish entry */
  retryRelay: (entryId: string, relay: string) => Promise<void>;
  /** Total count of all entries (before filtering) */
  totalCount: number;
  /** Per-type counts (before filtering) */
  typeCounts: Record<string, number>;
}

/**
 * Hook to access and filter event log entries
 *
 * @example
 * ```tsx
 * const { entries } = useEventLog();
 * const { entries } = useEventLog({ types: ["PUBLISH", "CONNECT"] });
 * const { entries } = useEventLog({ relay: "wss://relay.example.com/" });
 * ```
 */
export function useEventLog(
  options: UseEventLogOptions = {},
): UseEventLogResult {
  const { types, relay, limit } = options;

  const [entries, setEntries] = useState<LogEntry[]>(() =>
    eventLog.getEntries(),
  );

  // Subscribe to log updates
  useEffect(() => {
    const subscription = eventLog.entries$.subscribe(setEntries);
    return () => subscription.unsubscribe();
  }, []);

  // Filter entries based on options
  const filteredEntries = useMemo(() => {
    let result = entries;

    if (types && types.length > 0) {
      result = result.filter((e) => types.includes(e.type));
    }

    if (relay) {
      result = result.filter((e) => e.relay === relay);
    }

    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }

    return result;
  }, [entries, types, relay, limit]);

  const clear = useCallback(() => eventLog.clear(), []);

  const retryFailedRelays = useCallback(
    (entryId: string) => eventLog.retryFailedRelays(entryId),
    [],
  );

  const retryRelay = useCallback(
    (entryId: string, relay: string) => eventLog.retryRelay(entryId, relay),
    [],
  );

  // Per-type counts from unfiltered entries
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts;
  }, [entries]);

  return {
    entries: filteredEntries,
    clear,
    retryFailedRelays,
    retryRelay,
    totalCount: entries.length,
    typeCounts,
  };
}
