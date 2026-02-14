/**
 * React hook for accessing the Event Log
 *
 * Provides reactive access to relay operation logs with filtering capabilities.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import eventLog, {
  type LogEntry,
  type EventLogType,
  type PublishLogEntry,
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
  /** Publish entries with full status info */
  publishEntries: PublishLogEntry[];
  /** Clear all log entries */
  clear: () => void;
  /** Retry failed relays for a publish entry */
  retryFailedRelays: (entryId: string) => Promise<void>;
  /** Total count of all entries (before filtering) */
  totalCount: number;
}

/**
 * Hook to access and filter event log entries
 *
 * @example
 * ```tsx
 * // Get all entries
 * const { entries } = useEventLog();
 *
 * // Filter by type
 * const { entries } = useEventLog({ types: ["PUBLISH", "CONNECT"] });
 *
 * // Filter by relay
 * const { entries } = useEventLog({ relay: "wss://relay.example.com/" });
 *
 * // Limit results
 * const { entries } = useEventLog({ limit: 50 });
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
    const subscription = eventLog.entries$.subscribe((newEntries) => {
      setEntries(newEntries);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Filter entries based on options
  const filteredEntries = useMemo(() => {
    let result = entries;

    // Filter by types
    if (types && types.length > 0) {
      result = result.filter((e) => types.includes(e.type));
    }

    // Filter by relay
    if (relay) {
      result = result.filter((e) => e.relay === relay);
    }

    // Apply limit
    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }

    return result;
  }, [entries, types, relay, limit]);

  // Get publish entries
  const publishEntries = useMemo(() => {
    return filteredEntries.filter(
      (e): e is PublishLogEntry => e.type === "PUBLISH",
    );
  }, [filteredEntries]);

  // Clear all entries
  const clear = useCallback(() => {
    eventLog.clear();
  }, []);

  // Retry failed relays
  const retryFailedRelays = useCallback(async (entryId: string) => {
    await eventLog.retryFailedRelays(entryId);
  }, []);

  return {
    entries: filteredEntries,
    publishEntries,
    clear,
    retryFailedRelays,
    totalCount: entries.length,
  };
}

/**
 * Hook to get the latest entry of a specific type
 */
export function useLatestLogEntry(type: EventLogType): LogEntry | undefined {
  const { entries } = useEventLog({ types: [type], limit: 1 });
  return entries[0];
}

/**
 * Hook to subscribe to new log entries as they arrive
 */
export function useNewLogEntry(
  callback: (entry: LogEntry) => void,
  types?: EventLogType[],
): void {
  useEffect(() => {
    const subscription = eventLog.newEntry$.subscribe((entry) => {
      if (!types || types.length === 0 || types.includes(entry.type)) {
        callback(entry);
      }
    });

    return () => subscription.unsubscribe();
  }, [callback, types]);
}
