import { firstValueFrom, take, timeout } from "rxjs";

import { getTagValues, resolveFilterAliases } from "./nostr-utils";
import { isValidRelayURL } from "./relay-url";

import accountManager from "@/services/accounts";
import eventStore from "@/services/event-store";
import {
  FALLBACK_RELAYS,
  INDEXER_RELAYS,
  addressLoader,
} from "@/services/loaders";
import type { NostrFilter } from "@/types/nostr";

/**
 * The only bound on how many events one query returns.
 *
 * Not a policy — the model decides how many it needs, and it knows what it is
 * about to read better than a number here does. This exists because the result
 * is rendered as events and fed back as JSON: a five-figure answer freezes the
 * pane and blows the context window, killing the turn the model was in the
 * middle of. High enough that no reasonable request meets it.
 */
export const MAX_QUERY_LIMIT = 500;
/** Default when the model names no limit. Small on purpose: a peek, not a crawl. */
const DEFAULT_LIMIT = 5;
/** How long to wait for a contact list before giving up on `$contacts`. */
const CONTACTS_TIMEOUT = 6_000;
/**
 * Where a NIP-50 search goes when the user has no search relay list.
 *
 * The one hardcoded relay in this file, and only as a last resort: search cannot
 * be routed by the outbox model — it needs a relay that actually implements
 * NIP-50, and there is no way to discover one from the user's own lists when they
 * have not named any.
 */
const SEARCH_RELAY_FALLBACK = "wss://search.nos.today/";

const HEX64 = /^[0-9a-f]{64}$/i;
const SINGLE_LETTER = /^[a-zA-Z]$/;
const ALIASES = new Set(["$me", "$contacts"]);

function isAlias(value: string): boolean {
  return ALIASES.has(value.toLowerCase());
}

/** Fields that narrow a REQ. One is required; `limit` alone is not a filter. */
const CONSTRAINING = ["ids", "authors", "kinds", "search"] as const;

export type SanitizedFilter =
  { error: string } | { filter: NostrFilter; relays: string[] };

/**
 * A model's arguments as a NIP-01 filter.
 *
 * The whole filter is available — `ids`, `authors`, `kinds`, `since`, `until`,
 * `search`, and single-letter tags — because a subset makes the model write
 * commands instead of queries, or ask for kind 1 and filter in its head.
 * Aliases pass through untouched for {@link resolveAliases}.
 */
export function sanitizeFilter(args: unknown): SanitizedFilter {
  const input = (args ?? {}) as Record<string, unknown>;
  const filter: NostrFilter = {};

  const ids = hexList(input.ids);
  if (ids?.length) filter.ids = ids;

  // Authors keep `$me` / `$contacts` — resolving them needs the account.
  const authors = hexList(input.authors, { aliases: true });
  if (authors?.length) filter.authors = authors;

  if (Array.isArray(input.kinds)) {
    const kinds = input.kinds.filter(
      (kind): kind is number =>
        typeof kind === "number" && Number.isFinite(kind),
    );
    if (kinds.length) filter.kinds = kinds;
  }

  const since = timestamp(input.since);
  if (since !== undefined) filter.since = since;
  const until = timestamp(input.until);
  if (until !== undefined) filter.until = until;

  if (typeof input.search === "string" && input.search.trim()) {
    filter.search = input.search.trim();
  }

  const tags = tagFilters(input.tags);
  if ("error" in tags) return tags;
  Object.assign(filter, tags.value);

  const hasTag = Object.keys(filter).some((key) => key.startsWith("#"));
  if (!hasTag && !CONSTRAINING.some((key) => key in filter)) {
    return {
      error:
        "Give at least one of kinds, ids, authors, search, or tags — an " +
        "unfiltered REQ is refused.",
    };
  }

  if (
    filter.since !== undefined &&
    filter.until !== undefined &&
    filter.since > filter.until
  ) {
    return { error: "since is after until, so nothing can match." };
  }

  filter.limit = Math.min(
    typeof input.limit === "number" && input.limit > 0
      ? Math.floor(input.limit)
      : DEFAULT_LIMIT,
    MAX_QUERY_LIMIT,
  );

  const named =
    Array.isArray(input.relays) &&
    input.relays.length > 0 &&
    input.relays.every((relay): relay is string => typeof relay === "string")
      ? input.relays
      : undefined;

  return { filter, relays: named ?? defaultRelays(filter) };
}

/**
 * Where a filter goes when the model named no relay — which is almost always,
 * since it is told not to.
 *
 * A `search` filter is a different network: NIP-50 is optional, most relays
 * ignore the field entirely and answer with their newest events instead, so a
 * search sent to the general set comes back looking like a working query with
 * irrelevant results. The user's own search relay list (NIP-51 kind 10007) is the
 * right answer; `SEARCH_RELAY_FALLBACK` is for an account that has never set one.
 */
function defaultRelays(filter: NostrFilter): string[] {
  if (typeof filter.search !== "string") return FALLBACK_RELAYS;
  const configured = searchRelays();
  return configured.length > 0 ? configured : [SEARCH_RELAY_FALLBACK];
}

/**
 * The active account's search relays, from the list the settings panel edits.
 *
 * Read from the EventStore, which `useAccountSync` keeps filled with kind 10007
 * among the other relay lists — so this is a lookup, not a fetch.
 */
function searchRelays(): string[] {
  const pubkey = accountManager.active?.pubkey;
  if (!pubkey) return [];
  try {
    const event = eventStore.getReplaceable(10007, pubkey);
    if (!event) return [];
    // Raw tag values, checked here. The list parsers normalise first — they
    // prepend a scheme, turning `https://x/rss` into `wss://https/x/rss`, which
    // then passes a URL check and is useless as a relay. A `relay` tag holds
    // whatever someone's client wrote, so it is read as written and rejected as
    // written.
    return getTagValues(event, "relay").filter(isValidRelayURL);
  } catch {
    return [];
  }
}

/** Hex-only list, silently dropping npubs and note ids the model guessed at. */
function hexList(
  value: unknown,
  options?: { aliases?: boolean },
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" &&
      (HEX64.test(entry) || (options?.aliases === true && isAlias(entry))),
  );
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * `{ t: ["nostr"] }` → `{ "#t": ["nostr"] }`.
 *
 * A nested object rather than `#t` keys directly: JSON Schema cannot describe
 * an open set of `#<letter>` properties in a way every provider honours, and a
 * model that invents `#hashtag` would otherwise ship an ignored filter.
 */
function tagFilters(
  value: unknown,
): { error: string } | { value: Record<string, string[]> } {
  if (value == null) return { value: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: 'tags must be an object, e.g. {"t": ["nostr"]}.' };
  }

  const out: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(value)) {
    const letter = name.replace(/^#/, "");
    if (!SINGLE_LETTER.test(letter)) {
      return {
        error: `Tag "${name}" is not a single-letter tag; only those are indexed.`,
      };
    }
    const list = (Array.isArray(values) ? values : [values]).filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
    if (list.length) out[`#${letter}`] = list;
  }
  return { value: out };
}

/** True when the filter still holds a `$me` / `$contacts` to expand. */
export function hasAliases(filter: NostrFilter): boolean {
  const lists = [filter.authors, filter["#p"], filter["#P"]];
  return lists.some((list) => list?.some((entry) => isAlias(entry)));
}

/**
 * Expand `$me` and `$contacts`, the same aliases `req` accepts.
 *
 * The model cannot know the user's pubkey and must not be told it just to write
 * a filter, so the page substitutes it here — which also means a query about
 * "my follows" needs no pubkey in the prompt at all.
 */
export async function resolveAliases(
  filter: NostrFilter,
): Promise<{ error: string } | { filter: NostrFilter }> {
  if (!hasAliases(filter)) return { filter };

  const pubkey = accountManager.active?.pubkey;
  if (!pubkey) {
    return {
      error: "No account is active, so $me and $contacts cannot be resolved.",
    };
  }

  const wantsContacts = [filter.authors, filter["#p"], filter["#P"]].some(
    (list) => list?.some((entry) => entry.toLowerCase() === "$contacts"),
  );
  const contacts = wantsContacts ? await loadContacts(pubkey) : [];
  if (wantsContacts && contacts.length === 0) {
    return { error: "Could not load this account's contact list." };
  }

  return { filter: resolveFilterAliases(filter, pubkey, contacts) };
}

async function loadContacts(pubkey: string): Promise<string[]> {
  const cached = eventStore.getReplaceable(3, pubkey);
  if (cached) return pTags(cached);

  try {
    const event = await firstValueFrom(
      addressLoader({ kind: 3, pubkey, relays: INDEXER_RELAYS }).pipe(
        timeout(CONTACTS_TIMEOUT),
        take(1),
      ),
    );
    return event ? pTags(event) : [];
  } catch {
    return [];
  }
}

function pTags(event: Parameters<typeof getTagValues>[0]): string[] {
  return getTagValues(event, "p").filter((entry) => HEX64.test(entry));
}
