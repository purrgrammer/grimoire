/**
 * Who wrote each note a draft quotes — proven, not assumed.
 *
 * NIP-10 asks that the authors of `q`-tagged events be `p`-tagged. The only
 * author this hook reports is the `pubkey` of the quoted event itself, from
 * the EventStore (which verifies signatures on insert), re-checked here with
 * `verifyEvent`. An nevent's author TLV is only passed to the loader as a
 * place to look; it is never reported as the author.
 *
 * - `pending`: still looking.
 * - `resolved`: the event is in hand; `author` is its signed pubkey.
 * - `not-found`: every relay the loader asked answered without it, or the
 *   lookup ran past {@link QUOTE_LOOKUP_TIMEOUT_MS}. The store stays watched,
 *   so a late arrival from anywhere still flips it to `resolved`.
 *
 * The loader is the same `eventLoader` the editor's quote preview uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyEvent, type NostrEvent } from "nostr-tools";
import { filter, timeout } from "rxjs";
import type { Subscription } from "rxjs";
import eventStore from "@/services/event-store";
import { eventLoader } from "@/services/loaders";
import type { PostQuote } from "@/lib/post-template";

export const QUOTE_LOOKUP_TIMEOUT_MS = 10_000;

export type QuoteAuthorResolution =
  | { status: "pending" }
  | { status: "resolved"; author: string }
  | { status: "not-found" };

const PENDING: QuoteAuthorResolution = { status: "pending" };

export interface QuoteAuthors {
  get: (id: string) => QuoteAuthorResolution;
  /** Verified authors by event id. */
  authors: ReadonlyMap<string, string>;
  /** Wait (at most `timeoutMs`) for these quotes, then report what is known. */
  settle: (
    quotes: readonly PostQuote[],
    timeoutMs: number,
  ) => Promise<Map<string, QuoteAuthorResolution>>;
}

interface Entry {
  subscriptions: Subscription[];
  settled: Promise<void>;
  markSettled: () => void;
}

export function useQuoteAuthors(quotes: readonly PostQuote[]): QuoteAuthors {
  const [resolutions, setResolutions] = useState<
    Record<string, QuoteAuthorResolution>
  >({});
  const latestRef = useRef<Record<string, QuoteAuthorResolution>>({});
  const entriesRef = useRef(new Map<string, Entry>());

  const update = useCallback((id: string, next: QuoteAuthorResolution) => {
    const current = latestRef.current[id];
    // A resolved author is final; a later "not-found" cannot undo it.
    if (current?.status === "resolved") return;
    latestRef.current = { ...latestRef.current, [id]: next };
    setResolutions(latestRef.current);
    if (next.status !== "pending") entriesRef.current.get(id)?.markSettled();
  }, []);

  /** Start watching and loading quotes not seen yet (idempotent). */
  const ensure = useCallback(
    (list: readonly PostQuote[]) => {
      const entries = entriesRef.current;
      for (const { id, hintedAuthor, relays } of list) {
        if (entries.has(id)) continue;
        let markSettled = () => {};
        const settled = new Promise<void>((resolve) => {
          markSettled = resolve;
        });
        const entry: Entry = { subscriptions: [], settled, markSettled };
        entries.set(id, entry);

        // Watch with getEvent + insert$, not eventStore.event(): that model
        // starts the store's own fallback load (loaders.ts registers one),
        // which would be a second REQ next to the eventLoader below.
        const accept = (event: NostrEvent | undefined) => {
          if (event && event.id === id && verifyEvent(event)) {
            update(id, { status: "resolved", author: event.pubkey });
          }
        };
        accept(eventStore.getEvent(id));
        entry.subscriptions.push(
          eventStore.insert$
            .pipe(filter((event) => event.id === id))
            .subscribe(accept),
        );
        entry.subscriptions.push(
          eventLoader({
            id,
            relays: relays.length > 0 ? relays : undefined,
            author: hintedAuthor || undefined,
          })
            .pipe(timeout(QUOTE_LOOKUP_TIMEOUT_MS))
            .subscribe({
              complete: () => update(id, { status: "not-found" }),
              error: () => update(id, { status: "not-found" }),
            }),
        );
      }
    },
    [update],
  );

  const quotesKey = JSON.stringify(
    [...quotes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((q) => [q.id, q.hintedAuthor ?? "", q.relays]),
  );

  useEffect(() => {
    const list = JSON.parse(quotesKey) as [string, string, string[]][];
    ensure(
      list.map(([id, hintedAuthor, relays]) => ({
        id,
        hintedAuthor: hintedAuthor || undefined,
        relays,
      })),
    );
  }, [quotesKey, ensure]);

  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      for (const entry of entries.values()) {
        for (const sub of entry.subscriptions) sub.unsubscribe();
      }
      entries.clear();
    };
  }, []);

  const get = useCallback(
    (id: string) => resolutions[id] ?? PENDING,
    [resolutions],
  );

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, r] of Object.entries(resolutions)) {
      if (r.status === "resolved") map.set(id, r.author);
    }
    return map;
  }, [resolutions]);

  const settle = useCallback(
    async (list: readonly PostQuote[], ms: number) => {
      ensure(list);
      const ids = list.map((q) => q.id);
      const pending = ids
        .filter((id) => (latestRef.current[id] ?? PENDING).status === "pending")
        .map((id) => entriesRef.current.get(id)?.settled)
        .filter((p): p is Promise<void> => !!p);
      if (pending.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.all(pending),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
          }),
        ]);
        if (timer) clearTimeout(timer);
      }
      return new Map(
        ids.map((id) => [id, latestRef.current[id] ?? PENDING] as const),
      );
    },
    [ensure],
  );

  return useMemo(() => ({ get, authors, settle }), [get, authors, settle]);
}
