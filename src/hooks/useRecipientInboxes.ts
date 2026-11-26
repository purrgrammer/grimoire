/**
 * The NIP-65 inbox relays of the people a draft tags, kept current.
 *
 * Built on {@link resolveInboxRelays}, the shared lookup, and on the
 * late-arrival pattern of `useOutboxRelays`: a kind:10002 that reaches the
 * EventStore after the first answer (a slow indexer, or the person editing
 * their list) re-resolves that person only.
 *
 * - Lookups are memoized per pubkey for the composer's lifetime, so removing
 *   and re-adding a mention does not read again.
 * - Every lookup carries a generation. An answer from a superseded lookup, or
 *   one that lands after unmount, is dropped — it never overwrites a newer
 *   answer.
 * - `settle()` is what Publish uses: it waits for the given people's pending
 *   lookups, bounded by a deadline, and returns whatever is known then. A
 *   relay that never answers cannot hold Publish.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import eventStore from "@/services/event-store";
import {
  resolveInboxRelays,
  type InboxResolution,
} from "@/services/relay-selection";

/** Coalesce a burst of kind:10002 arrivals into one re-resolve per person. */
const LATE_LIST_DEBOUNCE_MS = 300;

const PENDING: InboxResolution = { status: "pending" };

interface Entry {
  generation: number;
  promise: Promise<void>;
}

export interface RecipientInboxes {
  /** Resolution per pubkey; `pending` for anything not answered yet. */
  get: (pubkey: string) => InboxResolution;
  /** Start lookups for people not seen yet (idempotent). */
  ensure: (pubkeys: readonly string[]) => void;
  /** Wait (at most `timeoutMs`) for these people, then report what is known. */
  settle: (
    pubkeys: readonly string[],
    timeoutMs: number,
  ) => Promise<Map<string, InboxResolution>>;
}

export function useRecipientInboxes(
  pubkeys: readonly string[],
): RecipientInboxes {
  const [resolutions, setResolutions] = useState<
    Record<string, InboxResolution>
  >({});
  // Mirrors `resolutions` for `settle()`, which must read the latest answers
  // after awaiting rather than the ones captured at call time.
  const latestRef = useRef<Record<string, InboxResolution>>({});
  const entriesRef = useRef(new Map<string, Entry>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const start = useCallback((pubkey: string) => {
    const entries = entriesRef.current;
    const generation = (entries.get(pubkey)?.generation ?? 0) + 1;
    const promise = resolveInboxRelays(pubkey).then((resolution) => {
      if (!mountedRef.current) return;
      if (entries.get(pubkey)?.generation !== generation) return; // stale
      latestRef.current = { ...latestRef.current, [pubkey]: resolution };
      setResolutions(latestRef.current);
    });
    entries.set(pubkey, { generation, promise });
  }, []);

  const ensure = useCallback(
    (list: readonly string[]) => {
      for (const pubkey of list) {
        if (!entriesRef.current.has(pubkey)) start(pubkey);
      }
    },
    [start],
  );

  const pubkeysKey = [...pubkeys].sort().join(",");

  useEffect(() => {
    if (!pubkeysKey) return;
    ensure(pubkeysKey.split(","));
  }, [pubkeysKey, ensure]);

  // Re-resolve a person whose relay list changes while the composer is open.
  // `filters()` replays what the store already holds on subscribe; those are
  // what the lookup itself reads, so they only set the baseline.
  useEffect(() => {
    if (!pubkeysKey) return;
    const authors = pubkeysKey.split(",");
    const newest = new Map<string, number>();
    const dirty = new Set<string>();
    let replaying = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = eventStore
      .filters({ kinds: [10002], authors })
      .subscribe((event) => {
        if ((newest.get(event.pubkey) ?? -1) >= event.created_at) return;
        newest.set(event.pubkey, event.created_at);
        if (replaying) return;
        // A first lookup still in flight reads the store itself.
        if (!entriesRef.current.has(event.pubkey)) return;
        dirty.add(event.pubkey);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          for (const pubkey of dirty) start(pubkey);
          dirty.clear();
        }, LATE_LIST_DEBOUNCE_MS);
      });
    replaying = false;
    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [pubkeysKey, start]);

  const get = useCallback(
    (pubkey: string) => resolutions[pubkey] ?? PENDING,
    [resolutions],
  );

  const settle = useCallback(
    async (list: readonly string[], timeoutMs: number) => {
      ensure(list);
      const pending = list
        .filter((pk) => (latestRef.current[pk] ?? PENDING).status === "pending")
        .map((pk) => entriesRef.current.get(pk)?.promise)
        .filter((p): p is Promise<void> => !!p);
      if (pending.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.all(pending),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
      }
      return new Map(
        list.map((pk) => [pk, latestRef.current[pk] ?? PENDING] as const),
      );
    },
    [ensure],
  );

  return useMemo(() => ({ get, ensure, settle }), [get, ensure, settle]);
}
