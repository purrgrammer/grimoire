import { SPELL_KIND, SCROLL_KIND } from "@/constants/kinds";
import type { TagStrategy } from "@/lib/favorite-tag-strategies";
import { groupTagStrategy } from "@/lib/favorite-tag-strategies";

export interface FavoriteListConfig {
  /** The replaceable list kind that stores favorites (e.g., 10777) */
  listKind: number;
  /** The kind of events stored in the list (e.g., 777 for spells) */
  elementKind: number;
  /** Human-readable label for UI */
  label: string;
  /** Override the default e/a tag strategy (derived from isAddressableKind) */
  tagStrategy?: TagStrategy;
}

/**
 * Maps event kind → favorite list configuration.
 *
 * Tag type ("e" vs "a") is derived at runtime from isAddressableKind(elementKind)
 * unless a custom tagStrategy is provided.
 * To add a new favoritable kind, just add an entry here.
 */
export const FAVORITE_LISTS: Record<number, FavoriteListConfig> = {
  [SPELL_KIND]: {
    listKind: 10777,
    elementKind: SPELL_KIND,
    label: "Favorite Spells",
  },
  30617: {
    listKind: 10018,
    elementKind: 30617,
    label: "Favorite Repositories",
  },
  30030: {
    listKind: 10030,
    elementKind: 30030,
    label: "Emoji Sets",
  },
  [SCROLL_KIND]: {
    listKind: 10027,
    elementKind: SCROLL_KIND,
    label: "Favorite Scrolls",
  },
  39000: {
    listKind: 10009,
    elementKind: 39000,
    label: "Favorite Groups",
    tagStrategy: groupTagStrategy,
  },
};

/**
 * Dummy config used as a stable fallback so hooks can be called unconditionally.
 * Points at a kind combo that will never match real data.
 */
export const FALLBACK_FAVORITE_CONFIG: FavoriteListConfig = {
  listKind: -1,
  elementKind: -1,
  label: "",
};

/** Look up config for a given event kind */
export function getFavoriteConfig(
  eventKind: number,
): FavoriteListConfig | undefined {
  return FAVORITE_LISTS[eventKind];
}

/** All list kinds that need to be fetched at bootstrap */
export const ALL_FAVORITE_LIST_KINDS = [
  ...new Set(Object.values(FAVORITE_LISTS).map((c) => c.listKind)),
];
