/**
 * `post` drafts in localStorage.
 *
 * The key is unchanged from the first composer
 * (`grimoire-post-draft-<pubkey>[-<windowId>]`), so existing drafts are found.
 * The shape moved to version 2, which stores what the user DECIDED instead of
 * the resulting selection (see `post-relays.ts`):
 *
 * - `overrides`: URL → explicit on/off, only for relays the user toggled
 * - `addedRelays`: relays typed in by hand
 * - `excludedRecipients`: pubkeys the user chose not to tag
 *
 * ## Reading a version 1 draft
 *
 * v1 stored `selectedRelays`, the whole checked set at save time, plus
 * `addedRelays`. Only some intentions in it can be proven:
 *
 * - An added relay missing from `selectedRelays` was unticked: an added relay
 *   starts checked, and being in `addedRelays` proves it was in the list.
 *   It becomes an `off` override.
 * - A selected relay is what the default gives anyway. Nothing to store.
 * - An account write relay missing from `selectedRelays` is ambiguous: it was
 *   either unticked or not yet in the account's relay list when the draft was
 *   saved (and v1 lost unticks to the late-list bug besides). Turning it off
 *   would invent a choice, so it is left at its default, checked.
 *
 * The editor content and the added relays always survive.
 */
import { tryNormalizeRelay } from "@/lib/post-relays";

export const POST_DRAFT_STORAGE_KEY = "grimoire-post-draft";

export function postDraftKey(pubkey: string, windowId?: string): string {
  return windowId
    ? `${POST_DRAFT_STORAGE_KEY}-${pubkey}-${windowId}`
    : `${POST_DRAFT_STORAGE_KEY}-${pubkey}`;
}

export interface PostDraft {
  version: 2;
  /** Full editor JSON (blobs, emoji, mentions). */
  editorState: unknown;
  overrides: Record<string, boolean>;
  addedRelays: string[];
  excludedRecipients: string[];
  timestamp: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

function relayList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const url of value) {
    if (typeof url !== "string") continue;
    const normalized = tryNormalizeRelay(url);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function overrideMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [url, on] of Object.entries(value)) {
    if (typeof on !== "boolean") continue;
    const normalized = tryNormalizeRelay(url);
    if (normalized) out[normalized] = on;
  }
  return out;
}

/** Parse a stored draft of either version. `null` for none or unreadable. */
export function parsePostDraft(raw: string | null): PostDraft | null {
  if (!raw) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const addedRelays = relayList(data.addedRelays);
  const timestamp = typeof data.timestamp === "number" ? data.timestamp : 0;

  if (data.version === 2) {
    return {
      version: 2,
      editorState: data.editorState,
      overrides: overrideMap(data.overrides),
      addedRelays,
      excludedRecipients: Array.isArray(data.excludedRecipients)
        ? [
            ...new Set(
              data.excludedRecipients.filter(
                (pk): pk is string => typeof pk === "string" && HEX64.test(pk),
              ),
            ),
          ]
        : [],
      timestamp,
    };
  }

  // Version 1 (no `version` field).
  const overrides: Record<string, boolean> = {};
  if (Array.isArray(data.selectedRelays)) {
    const selected = new Set(relayList(data.selectedRelays));
    for (const url of addedRelays) {
      if (!selected.has(url)) overrides[url] = false;
    }
  }
  return {
    version: 2,
    editorState: data.editorState,
    overrides,
    addedRelays,
    excludedRecipients: [],
    timestamp,
  };
}

export function serializePostDraft(
  draft: Omit<PostDraft, "version" | "timestamp">,
  now = Date.now(),
): string {
  const value: PostDraft = { version: 2, ...draft, timestamp: now };
  return JSON.stringify(value);
}
