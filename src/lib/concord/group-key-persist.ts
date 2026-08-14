/**
 * Persist the groupKey memo (`derive.ts`) across sessions, in Dexie.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/groupKeyPersist.ts`), with
 * armada's KV table swapped for grimoire's `concordKv`.
 *
 * Every derivation is a pure function of frozen wire format (CORD-02 Appendix
 * A), so a persisted entry can never go stale — only unused. A warm boot that
 * hydrates the memo pays zero secp256k1 point multiplications for the key sets
 * it derived last session (armada measured ~500ms of main-thread crypto per
 * boot on desktop, several times that on a phone).
 *
 * Trust note: this persists DERIVED stream secret keys at rest — the same
 * device-trust level as the decrypted membership vault beside it. Anyone with
 * local storage access already holds the inputs.
 *
 * One row holding one JSON array, not a row per entry: the blob is read once at
 * boot and written debounced, so a single value rides Dexie's batching.
 */

import db from "@/services/db";

import {
  exportGroupKeyMemo,
  importGroupKeyMemo,
  onGroupKeyMemoDirty,
} from "@/lib/concord/derive";

const KV_KEY = "concordGroupKeyMemo";

/**
 * Entries kept, newest first. The working set is O(communities × channels ×
 * held epochs), typically well under a thousand; the cap only sheds the stalest
 * leftovers of communities long gone.
 */
const MAX_PERSISTED = 4096;

/** Derivations arrive in bursts (one community's whole key set at once). */
const SAVE_DEBOUNCE_MS = 3000;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function scheduleSave(): void {
  dirty = true;
  saveTimer ??= setTimeout(save, SAVE_DEBOUNCE_MS);
}

function save(): Promise<void> {
  saveTimer = undefined;
  if (!dirty) return Promise.resolve();
  dirty = false;
  return db.concordKv
    .put({ key: KV_KEY, value: exportGroupKeyMemo(MAX_PERSISTED) })
    .then(() => undefined)
    .catch(() => undefined);
}

let started: Promise<void> | undefined;

/**
 * Hydrate the memo and start write-behind, once.
 *
 * Called from the first Concord read rather than at app boot: a grimoire user
 * who never opens a community should not pay a Dexie read for a cache of
 * derivations they will never make. A derivation racing the hydration is only a
 * cache miss, never wrong — the memo claims a hydrated entry solely for a key
 * it has not already derived.
 */
export function initGroupKeyPersistence(): Promise<void> {
  started ??= start();
  return started;
}

async function start(): Promise<void> {
  onGroupKeyMemoDirty(scheduleSave);
  // A tab that derives and then closes inside the debounce window still saves.
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      void save();
    });
  }
  try {
    const row = await db.concordKv.get(KV_KEY);
    if (Array.isArray(row?.value)) importGroupKeyMemo(row.value);
  } catch {
    // Best-effort: an unreadable cache just means keys re-derive as before.
  }
}

/** Wipe the persisted derivations (account removal / logout). */
export async function clearGroupKeyPersistence(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  dirty = false;
  await db.concordKv.delete(KV_KEY);
}

/** Test seam: forget that persistence was started. */
export function _resetGroupKeyPersistenceForTests(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = undefined;
  dirty = false;
  started = undefined;
}

/** Test seam: flush the debounced write immediately. */
export function _flushGroupKeyPersistenceForTests(): Promise<void> {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  return save();
}
