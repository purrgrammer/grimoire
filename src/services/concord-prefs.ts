/**
 * How this device arranges a chat sidebar: what is pinned, what is folded away,
 * and which channel each container was left on.
 *
 * All three are ARRANGEMENT, not content. Nothing here is published and nothing
 * here is a claim about an identity — armada keeps the same three per-device on
 * purpose (`PER_DEVICE_CONFIG_KEYS` at `bc19d1f:src/contexts/AppContext.ts`
 * holds `collapsedChannelCategories` and `lastChannelByServer`), because two
 * open clients that synced them would yank each other's channel selection
 * around. Grimoire has no settings sync at all, so per-device is the only
 * honest option as well as the right one.
 *
 * **localStorage rather than Dexie**, unlike the read cursors next door: the
 * open channel is resolved DURING a render — a derived value, never an effect
 * writing state — so the store has to answer synchronously. A BehaviorSubject
 * seeded from localStorage does; a Dexie read cannot. Armada resolves its open
 * channel the same way, from config already in memory.
 *
 * **The keys are PROTOCOL-QUALIFIED** ({@link containerPrefKey}), matching
 * `chatReads` and the `chatnotif:` levels. A channel id alone is never an
 * identity — a NIP-29 group is `(relay, id)`, and the same id forked onto
 * another relay is a different room — so the container is part of the key, and
 * a container id means nothing without the protocol that issued it. Concord is
 * the only writer today ({@link PROTOCOL}); a NIP-29 relay/group pair occupies
 * these same structures by parameterising the signatures below, not by
 * re-shaping what is stored.
 *
 * **Erased at logout** ({@link resetConcordPrefs}, wired into
 * `clearCommunities`). A pin and a last-open channel name the communities and
 * channels this account cared enough about to arrange — the same disclosure the
 * notification levels are wiped for. The one localStorage entry that
 * deliberately outlives a logout is the send-rate limit, and that is abuse
 * control rather than a preference.
 */

import { BehaviorSubject } from "rxjs";

import type { ChatProtocol } from "@/types/chat";

/**
 * Generic store, qualified entries — the shape `chatReads` and `chatnotif:`
 * already settled on. A second protocol writes into this same blob.
 */
export const CHAT_PREFS_STORAGE_KEY = "grimoire:chat-prefs";

/**
 * The field separator inside a pref key.
 *
 * `|`, the separator the notification levels moved to: a NIP-29 container is a
 * relay URL and `wss://[::1]/` puts a colon pair inside the segment, so `::`
 * cannot separate fields it may also contain. `|` appears in neither a URL nor
 * hex.
 */
const SEP = "|";

/** Which protocol the Concord-facing functions below read and write for. */
const PROTOCOL: ChatProtocol = "concord";

/** The key for a whole container — a Concord community, later a NIP-29 relay. */
export const containerPrefKey = (
  protocol: ChatProtocol,
  containerId: string,
): string => `${protocol}${SEP}${containerId.toLowerCase()}`;

/** The key for one channel inside its container. */
export const channelPrefKey = (
  protocol: ChatProtocol,
  containerId: string,
  channelIdHex: string,
): string =>
  `${containerPrefKey(protocol, containerId)}${SEP}${channelIdHex.toLowerCase()}`;

/**
 * Everything this device remembers about how a chat sidebar is arranged.
 *
 * `__version` is 1 because the shape shipped qualified — there was never an
 * unqualified generation of this blob to migrate from, which was the whole
 * point of writing it this way while the feature was new.
 */
export interface ChatPrefs {
  __version: 1;
  /** Channel keys ({@link channelPrefKey}) the reader pinned to the top. */
  pinnedChannels: string[];
  /** Container key → the casefolded `categoryKey()`s folded shut in it. */
  collapsedCategories: Record<string, string[]>;
  /** Container key → the channel id last opened there. */
  lastChannelByContainer: Record<string, string>;
}

const DEFAULT_PREFS: ChatPrefs = {
  __version: 1,
  pinnedChannels: [],
  collapsedCategories: {},
  lastChannelByContainer: {},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

function stringListRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    const list = stringList(entry);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry) out[key] = entry;
  }
  return out;
}

/**
 * Read the blob, keeping whatever of it is still recognisable.
 *
 * Field by field rather than all-or-nothing: this is arrangement, so the worst
 * a half-readable blob can cost is a category that opens or a pin that is gone.
 * Throwing — or discarding the whole blob because one field rotted — would
 * cost strictly more.
 */
export function loadPrefs(): ChatPrefs {
  try {
    const stored = localStorage.getItem(CHAT_PREFS_STORAGE_KEY);
    if (!stored) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return DEFAULT_PREFS;
    return {
      __version: 1,
      pinnedChannels: stringList(parsed.pinnedChannels),
      collapsedCategories: stringListRecord(parsed.collapsedCategories),
      lastChannelByContainer: stringRecord(parsed.lastChannelByContainer),
    };
  } catch (error) {
    console.warn("[concord] could not read the sidebar preferences:", error);
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: ChatPrefs): void {
  try {
    localStorage.setItem(CHAT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn("[concord] could not store the sidebar preferences:", error);
  }
}

// ---------------------------------------------------------------------------
// Pure readers. They take the SNAPSHOT a component already rendered from rather
// than reaching into the manager, so a render never reads a value the render
// did not subscribe to.
// ---------------------------------------------------------------------------

/** Whether this Concord channel is pinned above its category. */
export function isChannelPinned(
  prefs: ChatPrefs,
  communityIdHex: string,
  channelIdHex: string,
): boolean {
  return prefs.pinnedChannels.includes(
    channelPrefKey(PROTOCOL, communityIdHex, channelIdHex),
  );
}

/** Whether this community's category is folded shut. */
export function isCategoryCollapsed(
  prefs: ChatPrefs,
  communityIdHex: string,
  categoryKey: string,
): boolean {
  const key = containerPrefKey(PROTOCOL, communityIdHex);
  return (prefs.collapsedCategories[key] ?? []).includes(categoryKey);
}

/** The channel this community was last left on, if any. */
export function lastChannelOf(
  prefs: ChatPrefs,
  communityIdHex: string,
): string | undefined {
  return prefs.lastChannelByContainer[
    containerPrefKey(PROTOCOL, communityIdHex)
  ];
}

class ConcordPrefsManager {
  private subject = new BehaviorSubject<ChatPrefs>(loadPrefs());

  /**
   * A stable Observable, not a getter that mints one per access: `use$` keys
   * its subscription on the object identity it is handed, so a fresh Observable
   * every render is a fresh subscription every render.
   */
  readonly stream$ = this.subject.asObservable();

  get value(): ChatPrefs {
    return this.subject.value;
  }

  private commit(next: ChatPrefs): void {
    savePrefs(next);
    this.subject.next(next);
  }

  /** Pin, or unpin, one channel. */
  togglePin(communityIdHex: string, channelIdHex: string): void {
    if (!communityIdHex || !channelIdHex) return;
    const key = channelPrefKey(PROTOCOL, communityIdHex, channelIdHex);
    const current = this.value.pinnedChannels;
    const pinnedChannels = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    this.commit({ ...this.value, pinnedChannels });
  }

  /** Fold a category shut, or open it again. */
  toggleCategoryCollapsed(communityIdHex: string, categoryKey: string): void {
    if (!communityIdHex || !categoryKey) return;
    const key = containerPrefKey(PROTOCOL, communityIdHex);
    const collapsedCategories = { ...this.value.collapsedCategories };
    const current = collapsedCategories[key] ?? [];
    const next = current.includes(categoryKey)
      ? current.filter((k) => k !== categoryKey)
      : [...current, categoryKey];
    // No empty array left behind for every community ever visited — armada's
    // own hygiene, and the reason the blob does not grow with idle browsing.
    if (next.length > 0) collapsedCategories[key] = next;
    else delete collapsedCategories[key];
    this.commit({ ...this.value, collapsedCategories });
  }

  /**
   * Remember which channel this community was left on.
   *
   * A no-op when it has not moved, because the caller is a click handler that
   * fires on every pick including the one that changes nothing — and an emit
   * there would repaint every subscriber for no change.
   */
  setLastChannel(communityIdHex: string, channelIdHex: string): void {
    if (!communityIdHex || !channelIdHex) return;
    const key = containerPrefKey(PROTOCOL, communityIdHex);
    const value = channelIdHex.toLowerCase();
    if (this.value.lastChannelByContainer[key] === value) return;
    this.commit({
      ...this.value,
      lastChannelByContainer: {
        ...this.value.lastChannelByContainer,
        [key]: value,
      },
    });
  }

  /** The logout door: forget the arrangement, and say so. */
  reset(): void {
    try {
      localStorage.removeItem(CHAT_PREFS_STORAGE_KEY);
    } catch (error) {
      console.warn("[concord] could not clear the sidebar preferences:", error);
    }
    // Emitted rather than merely stored: a logout happens with the sidebar
    // still mounted, and a subscriber that is not told keeps painting the
    // previous account's pins until something unrelated re-renders it.
    this.subject.next(DEFAULT_PREFS);
  }
}

export const concordPrefsManager = new ConcordPrefsManager();

/**
 * Forget every pin, fold and last-open channel on this device.
 *
 * Called from `clearCommunities`. Named as a free function so the wipe reads as
 * a list of doors rather than a list of singletons.
 */
export function resetConcordPrefs(): void {
  concordPrefsManager.reset();
}
