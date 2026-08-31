/**
 * The NIP-51 kind-10006 "Blocked Relays" list, enforced.
 *
 * Grimoire fetched and edited this list for a long time without ever honouring
 * it — the settings copy promised relays your client would "never connect to"
 * and nothing consulted it. This module is the single source of truth that makes
 * the promise real; `BlockingRelayPool` is what enforces it on the wire.
 *
 * Deliberately dependency-free apart from URL helpers. The obvious shape —
 * subscribe to `accountManager.active$` right here — creates an import cycle,
 * because `accounts.ts` imports the relay pool and the pool has to import this
 * module to filter anything:
 *
 *   relay-pool -> blocking-relay-pool -> blocked-relays -> accounts -> relay-pool
 *
 * ESM tolerates that cycle but resolves it by handing whichever module evaluates
 * first an `undefined` binding, so the failure would be a silently empty
 * blocklist at startup — exactly the bug this feature exists to fix. So state
 * lives here and the account wiring lives in `blocked-relays-sync.ts`, which
 * nothing on the pool's import path touches.
 *
 * Public tags only: hidden (NIP-44 encrypted) list entries are not read, so
 * switching accounts never prompts a signer.
 */

import { BehaviorSubject } from "rxjs";
import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * Where the last known blocked set is kept between sessions.
 *
 * The list is a replaceable event fetched over the network, and the EventStore
 * is in-memory, so a cold start would otherwise enforce nothing until that
 * fetch lands: blocked relays visibly join the pool out of the gate and are
 * pruned a second or two later. Seeding synchronously from the last session
 * closes that window for every load after the first, and still gates startup on
 * nothing.
 *
 * Stored with the pubkey it belongs to, so a seed is never applied to another
 * account.
 */
const STORAGE_KEY = "grimoire:blocked-relays";

/**
 * Keyed by pubkey, with the last account seen recorded separately.
 *
 * A single-slot store lost the seed for anyone with two accounts: switching to
 * B before B's own list arrived cleared the slot, so returning to A found
 * nothing and A's startup window reopened on every cold start.
 */
interface PersistedBlocked {
  lastActive?: string;
  byPubkey: Record<string, string[]>;
}

function readPersisted(): PersistedBlocked {
  const empty: PersistedBlocked = { byPubkey: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;

    const record = parsed as Partial<PersistedBlocked>;
    if (typeof record.byPubkey !== "object" || record.byPubkey === null) {
      return empty;
    }

    const byPubkey: Record<string, string[]> = {};
    for (const [pubkey, relays] of Object.entries(record.byPubkey)) {
      if (!Array.isArray(relays)) continue;
      byPubkey[pubkey] = relays.filter((url) => typeof url === "string");
    }

    return {
      lastActive:
        typeof record.lastActive === "string" ? record.lastActive : undefined,
      byPubkey,
    };
  } catch {
    // Private mode, corrupt value, storage disabled. Enforcement still works;
    // it just starts from empty, as it did before this seed existed.
    return empty;
  }
}

const persisted = readPersisted();
const seed =
  persisted.lastActive !== undefined
    ? {
        pubkey: persisted.lastActive,
        relays: persisted.byPubkey[persisted.lastActive] ?? [],
      }
    : null;

/** The pubkey the loaded set belongs to, so a seed is not reused across accounts. */
let owner: string | null = seed?.pubkey ?? null;

/** Normalized URLs of relays the active account has blocked. */
const blockedSubject = new BehaviorSubject<ReadonlySet<string>>(
  normalizeAll(seed?.relays ?? []),
);

/** Observable of the blocked relay set. Emits the empty set with no account. */
export const blocked$ = blockedSubject.asObservable();

/** The current blocked set, for synchronous checks on the wire path. */
export function getBlockedRelays(): ReadonlySet<string> {
  return blockedSubject.value;
}

/**
 * Normalizes a URL for comparison against the blocked set, or returns null.
 *
 * `normalizeRelayURL` throws by contract, and this runs on every read and
 * publish in the app against URLs that arrive from relay hints — i.e. from
 * strangers, with arbitrary case and occasional garbage. A URL that cannot be
 * normalized is not blocked; the pool's own validation is what rejects it. One
 * malformed hint must never take down a whole subscription.
 */
function compareKey(url: string): string | null {
  try {
    return normalizeRelayURL(url);
  } catch {
    return null;
  }
}

/** Normalizes URLs into a comparison set, dropping any that cannot be parsed. */
function normalizeAll(urls: Iterable<string>): ReadonlySet<string> {
  const set = new Set<string>();
  for (const url of urls) {
    const key = compareKey(url);
    if (key !== null) set.add(key);
  }
  return set;
}

/** The pubkey whose blocked set is currently loaded, or null when none is. */
export function getBlockedRelaysOwner(): string | null {
  return owner;
}

/** Whether a relay is on the active account's blocked list. */
export function isRelayBlocked(url: string): boolean {
  const blocked = blockedSubject.value;
  if (blocked.size === 0) return false;
  const key = compareKey(url);
  return key !== null && blocked.has(key);
}

/**
 * Drops blocked relays from a list, preserving order and the caller's own URL
 * spelling — callers use these strings as map keys (`message.from`, per-relay
 * publish status), so rewriting them here would break that matching.
 */
export function filterBlockedRelays(urls: string[]): string[] {
  if (blockedSubject.value.size === 0) return urls;
  return urls.filter((url) => !isRelayBlocked(url));
}

/**
 * Replaces the blocked set. Called only by `blocked-relays-sync.ts`.
 *
 * Re-emitting an identical set would prune sockets that were opened since the
 * last emission, so identical sets are suppressed.
 */
export function setBlockedRelays(
  urls: Iterable<string>,
  ownerPubkey: string | null,
): void {
  const next = normalizeAll(urls);
  owner = ownerPubkey;

  try {
    if (ownerPubkey === null) {
      // Signed out, or an account whose own list has not arrived. Only the
      // pointer moves: another account's stored seed is still theirs, and
      // deleting it would reopen their startup window for good.
      delete persisted.lastActive;
    } else {
      persisted.lastActive = ownerPubkey;
      persisted.byPubkey[ownerPubkey] = [...next];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // A full or unavailable store must not break enforcement.
  }

  const current = blockedSubject.value;
  if (
    current.size === next.size &&
    [...next].every((url) => current.has(url))
  ) {
    return;
  }

  blockedSubject.next(next);
}
