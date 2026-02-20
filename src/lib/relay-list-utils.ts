import type { NostrEvent } from "nostr-tools";
import { normalizeRelayURL, isValidRelayURL } from "@/lib/relay-url";

// --- Types ---

export interface RelayEntry {
  url: string;
  read: boolean;
  write: boolean;
}

export type RelayMode = "readwrite" | "read" | "write";

export interface RelayListKindConfig {
  kind: number;
  name: string;
  description: string;
  /** Tag name used in the event: "r" for NIP-65, "relay" for NIP-51 */
  tagName: "r" | "relay";
  /** Whether read/write markers are supported (only kind 10002) */
  hasMarkers: boolean;
}

// --- Parsing ---

/** Parse relay entries from a Nostr event based on the kind config */
export function parseRelayEntries(
  event: NostrEvent | undefined,
  config: Pick<RelayListKindConfig, "tagName" | "hasMarkers">,
): RelayEntry[] {
  if (!event) return [];

  const entries: RelayEntry[] = [];
  const seenUrls = new Set<string>();

  for (const tag of event.tags) {
    if (tag[0] === config.tagName && tag[1]) {
      try {
        const url = normalizeRelayURL(tag[1]);
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        if (config.hasMarkers) {
          const marker = tag[2];
          entries.push({
            url,
            read: !marker || marker === "read",
            write: !marker || marker === "write",
          });
        } else {
          entries.push({ url, read: true, write: true });
        }
      } catch {
        // Skip invalid URLs
      }
    }
  }

  return entries;
}

// --- Tag Building ---

/** Build event tags from relay entries for a given kind config */
export function buildRelayListTags(
  entries: RelayEntry[],
  config: Pick<RelayListKindConfig, "tagName" | "hasMarkers">,
): string[][] {
  return entries.map((entry) => {
    if (config.tagName === "r" && config.hasMarkers) {
      if (entry.read && entry.write) return ["r", entry.url];
      if (entry.read) return ["r", entry.url, "read"];
      return ["r", entry.url, "write"];
    }
    return [config.tagName, entry.url];
  });
}

// --- Input Sanitization ---

/** Sanitize and normalize user input into a valid relay URL, or return null */
export function sanitizeRelayInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Add wss:// scheme if missing
  let url = trimmed;
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    url = `wss://${url}`;
  }

  try {
    const normalized = normalizeRelayURL(url);
    if (!isValidRelayURL(normalized)) return null;
    return normalized;
  } catch {
    return null;
  }
}

// --- Comparison ---

/** Check if two relay entry arrays are deeply equal */
export function relayEntriesEqual(a: RelayEntry[], b: RelayEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (entry, i) =>
      entry.url === b[i].url &&
      entry.read === b[i].read &&
      entry.write === b[i].write,
  );
}

// --- Mode Helpers ---

/** Get the mode string from a relay entry */
export function getRelayMode(entry: RelayEntry): RelayMode {
  if (entry.read && entry.write) return "readwrite";
  if (entry.read) return "read";
  return "write";
}

/** Create read/write flags from a mode string */
export function modeToFlags(mode: RelayMode): {
  read: boolean;
  write: boolean;
} {
  return {
    read: mode === "readwrite" || mode === "read",
    write: mode === "readwrite" || mode === "write",
  };
}
