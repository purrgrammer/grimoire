/**
 * Emoji Usage Tracking Service
 *
 * Tracks which emojis the user picks (both unicode and custom) in localStorage.
 * Provides a recency+frequency ranked list for empty-query suggestions.
 * Shared by both the `:` autocomplete and the EmojiPickerDialog.
 */

import type { EmojiSearchResult } from "./emoji-search";

const STORAGE_KEY = "grimoire:emoji-usage";
const OLD_STORAGE_KEY = "grimoire:reaction-history";
const MAX_ENTRIES = 100;

interface EmojiUsageEntry {
  count: number;
  lastUsed: number;
}

type EmojiUsageData = Record<string, EmojiUsageEntry>;

/** Convert an EmojiSearchResult to a storage key */
function toKey(result: EmojiSearchResult): string {
  return result.source === "unicode" ? result.url : `:${result.shortcode}:`;
}

/** One-time migration from old reaction-history format */
function migrateOldHistory(): EmojiUsageData | null {
  try {
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (!old) return null;

    const parsed: Record<string, number> = JSON.parse(old);
    const now = Date.now();
    const migrated: EmojiUsageData = {};

    for (const [key, count] of Object.entries(parsed)) {
      if (typeof count === "number" && count > 0) {
        migrated[key] = { count, lastUsed: now };
      }
    }

    localStorage.removeItem(OLD_STORAGE_KEY);
    return migrated;
  } catch {
    return null;
  }
}

/** Read usage data from localStorage, migrating if needed */
function readData(): EmojiUsageData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);

    // Try migrating old format
    const migrated = migrateOldHistory();
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return {};
  } catch {
    return {};
  }
}

/** Write usage data, evicting lowest-scored entries if over cap */
function writeData(data: EmojiUsageData): void {
  try {
    const keys = Object.keys(data);
    if (keys.length > MAX_ENTRIES) {
      const scored = keys.map((key) => ({
        key,
        score: computeScore(data[key]),
      }));
      scored.sort((a, b) => b.score - a.score);

      const trimmed: EmojiUsageData = {};
      for (const { key } of scored.slice(0, MAX_ENTRIES)) {
        trimmed[key] = data[key];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch (err) {
    console.error("[emoji-usage] Failed to write usage data:", err);
  }
}

/** Score: frequency weighted by recency (decays over days) */
function computeScore(entry: EmojiUsageEntry): number {
  const daysSinceLastUse =
    (Date.now() - entry.lastUsed) / (1000 * 60 * 60 * 24);
  return entry.count / (1 + daysSinceLastUse);
}

/**
 * Record that the user picked an emoji.
 * Call this from autocomplete command callbacks and the emoji picker.
 */
export function recordEmojiUsage(result: EmojiSearchResult): void {
  const key = toKey(result);
  const data = readData();
  const existing = data[key];

  data[key] = {
    count: (existing?.count ?? 0) + 1,
    lastUsed: Date.now(),
  };

  writeData(data);
}

/**
 * Get recently-used emoji keys ranked by recency+frequency score.
 * Keys are emoji chars for unicode (`"😀"`) or `":shortcode:"` for custom.
 */
export function getRecentEmojiKeys(limit = 24): string[] {
  const data = readData();
  const entries = Object.entries(data);
  if (entries.length === 0) return [];

  return entries
    .map(([key, entry]) => ({ key, score: computeScore(entry) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ key }) => key);
}

/**
 * Get raw usage data for components that need the full map
 * (e.g., EmojiPickerDialog's frequently-used top bar).
 */
export function getEmojiUsageMap(): EmojiUsageData {
  return readData();
}
