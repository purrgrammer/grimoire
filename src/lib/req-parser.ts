import { nip19 } from "nostr-tools";
import type { NostrFilter } from "@/types/nostr";
import { isNip05 } from "./nip05";
import {
  isValidHexPubkey,
  isValidHexEventId,
  normalizeHex,
} from "./nostr-validation";
import { normalizeRelayURL } from "./relay-url";

export interface ParsedReqCommand {
  filter: NostrFilter;
  relays?: string[];
  closeOnEose?: boolean;
  nip05Authors?: string[]; // NIP-05 identifiers that need async resolution
  nip05PTags?: string[]; // NIP-05 identifiers for #p tags that need async resolution
}

/**
 * Parse comma-separated values and apply a parser function to each
 * Returns true if at least one value was successfully parsed
 */
function parseCommaSeparated<T>(
  value: string,
  parser: (v: string) => T | null,
  target: Set<T>,
): boolean {
  const values = value.split(",").map((v) => v.trim());
  let addedAny = false;

  for (const val of values) {
    if (!val) continue;
    const parsed = parser(val);
    if (parsed !== null) {
      target.add(parsed);
      addedAny = true;
    }
  }

  return addedAny;
}

/**
 * Parse REQ command arguments into a Nostr filter
 * Supports:
 * - Filters: -k (kinds), -a (authors: hex/npub/nprofile/NIP-05), -l (limit), -e (#e), -p (#p: hex/npub/nprofile/NIP-05), -t (#t), -d (#d), --tag/-T (any #tag)
 * - Time: --since, --until
 * - Search: --search
 * - Relays: wss://relay.com or relay.com (auto-adds wss://), nprofile relay hints are automatically extracted
 * - Options: --close-on-eose (close stream after EOSE, default: stream stays open)
 */
export function parseReqCommand(args: string[]): ParsedReqCommand {
  const filter: NostrFilter = {};
  const relays: string[] = [];
  const nip05Authors = new Set<string>();
  const nip05PTags = new Set<string>();

  // Use sets for deduplication during accumulation
  const kinds = new Set<number>();
  const authors = new Set<string>();
  const eventIds = new Set<string>();
  const pTags = new Set<string>();
  const tTags = new Set<string>();
  const dTags = new Set<string>();

  // Map for arbitrary single-letter tags: letter -> Set<value>
  const genericTags = new Map<string, Set<string>>();

  let closeOnEose = false;

  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // Relay URLs (starts with wss://, ws://, or looks like a domain)
    if (arg.startsWith("wss://") || arg.startsWith("ws://")) {
      relays.push(normalizeRelayURL(arg));
      i++;
      continue;
    }

    // Shorthand relay (domain-like string without protocol)
    if (isRelayDomain(arg)) {
      relays.push(normalizeRelayURL(arg));
      i++;
      continue;
    }

    // Flags
    if (arg.startsWith("-")) {
      const flag = arg;
      const nextArg = args[i + 1];

      switch (flag) {
        case "-k":
        case "--kind": {
          // Support comma-separated kinds: -k 1,3,7
          if (!nextArg) {
            i++;
            break;
          }
          const addedAny = parseCommaSeparated(
            nextArg,
            (v) => {
              const kind = parseInt(v, 10);
              return isNaN(kind) ? null : kind;
            },
            kinds,
          );
          i += addedAny ? 2 : 1;
          break;
        }

        case "-a":
        case "--author": {
          // Support comma-separated authors: -a npub1...,npub2...,user@domain.com
          if (!nextArg) {
            i++;
            break;
          }
          let addedAny = false;
          const values = nextArg.split(",").map((a) => a.trim());
          for (const authorStr of values) {
            if (!authorStr) continue;
            // Check if it's a NIP-05 identifier
            if (isNip05(authorStr)) {
              nip05Authors.add(authorStr);
              addedAny = true;
            } else {
              const result = parseNpubOrHex(authorStr);
              if (result.pubkey) {
                authors.add(result.pubkey);
                addedAny = true;
                // Add relay hints from nprofile (normalized)
                if (result.relays) {
                  relays.push(...result.relays.map(normalizeRelayURL));
                }
              }
            }
          }
          i += addedAny ? 2 : 1;
          break;
        }

        case "-l":
        case "--limit": {
          const limit = parseInt(nextArg, 10);
          if (!isNaN(limit)) {
            filter.limit = limit;
            i += 2;
          } else {
            i++;
          }
          break;
        }

        case "-e": {
          // Support comma-separated event IDs: -e id1,id2,id3
          if (!nextArg) {
            i++;
            break;
          }
          const addedAny = parseCommaSeparated(
            nextArg,
            parseNoteOrHex,
            eventIds,
          );
          i += addedAny ? 2 : 1;
          break;
        }

        case "-p": {
          // Support comma-separated pubkeys: -p npub1...,npub2...,user@domain.com
          if (!nextArg) {
            i++;
            break;
          }
          let addedAny = false;
          const values = nextArg.split(",").map((p) => p.trim());
          for (const pubkeyStr of values) {
            if (!pubkeyStr) continue;
            // Check if it's a NIP-05 identifier
            if (isNip05(pubkeyStr)) {
              nip05PTags.add(pubkeyStr);
              addedAny = true;
            } else {
              const result = parseNpubOrHex(pubkeyStr);
              if (result.pubkey) {
                pTags.add(result.pubkey);
                addedAny = true;
                // Add relay hints from nprofile (normalized)
                if (result.relays) {
                  relays.push(...result.relays.map(normalizeRelayURL));
                }
              }
            }
          }
          i += addedAny ? 2 : 1;
          break;
        }

        case "-t": {
          // Support comma-separated hashtags: -t nostr,bitcoin,lightning
          if (nextArg) {
            const addedAny = parseCommaSeparated(
              nextArg,
              (v) => v, // hashtags are already strings
              tTags,
            );
            i += addedAny ? 2 : 1;
          } else {
            i++;
          }
          break;
        }

        case "-d": {
          // Support comma-separated d-tags: -d article1,article2,article3
          if (nextArg) {
            const addedAny = parseCommaSeparated(
              nextArg,
              (v) => v, // d-tags are already strings
              dTags,
            );
            i += addedAny ? 2 : 1;
          } else {
            i++;
          }
          break;
        }

        case "--since": {
          const timestamp = parseTimestamp(nextArg);
          if (timestamp) {
            filter.since = timestamp;
            i += 2;
          } else {
            i++;
          }
          break;
        }

        case "--until": {
          const timestamp = parseTimestamp(nextArg);
          if (timestamp) {
            filter.until = timestamp;
            i += 2;
          } else {
            i++;
          }
          break;
        }

        case "--search": {
          if (nextArg) {
            filter.search = nextArg;
            i += 2;
          } else {
            i++;
          }
          break;
        }

        case "--close-on-eose": {
          closeOnEose = true;
          i++;
          break;
        }

        case "-T":
        case "--tag": {
          // Generic tag filter: --tag <letter> <value>
          // Supports comma-separated values: --tag a val1,val2
          if (!nextArg) {
            i++;
            break;
          }

          // Next arg should be the single letter
          const letter = nextArg;
          const valueArg = args[i + 2];

          // Validate: must be single letter
          if (letter.length !== 1 || !valueArg) {
            i++;
            break;
          }

          // Get or create Set for this tag letter
          let tagSet = genericTags.get(letter);
          if (!tagSet) {
            tagSet = new Set<string>();
            genericTags.set(letter, tagSet);
          }

          // Parse comma-separated values
          const addedAny = parseCommaSeparated(
            valueArg,
            (v) => v, // tag values are already strings
            tagSet,
          );

          i += addedAny ? 3 : 1;
          break;
        }

        default:
          i++;
          break;
      }
    } else {
      i++;
    }
  }

  // Convert accumulated sets to filter arrays (with deduplication)
  if (kinds.size > 0) filter.kinds = Array.from(kinds);
  if (authors.size > 0) filter.authors = Array.from(authors);
  if (eventIds.size > 0) filter["#e"] = Array.from(eventIds);
  if (pTags.size > 0) filter["#p"] = Array.from(pTags);
  if (tTags.size > 0) filter["#t"] = Array.from(tTags);
  if (dTags.size > 0) filter["#d"] = Array.from(dTags);

  // Convert generic tags to filter
  for (const [letter, tagSet] of genericTags.entries()) {
    if (tagSet.size > 0) {
      (filter as any)[`#${letter}`] = Array.from(tagSet);
    }
  }

  return {
    filter,
    relays: relays.length > 0 ? relays : undefined,
    closeOnEose,
    nip05Authors: nip05Authors.size > 0 ? Array.from(nip05Authors) : undefined,
    nip05PTags: nip05PTags.size > 0 ? Array.from(nip05PTags) : undefined,
  };
}

/**
 * Check if a string looks like a relay domain
 * Must contain a dot and not be a flag
 */
function isRelayDomain(value: string): boolean {
  if (!value || value.startsWith("-")) return false;
  // Must contain at least one dot and look like a domain
  return /^[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(value);
}

/**
 * Parse timestamp - supports unix timestamp, relative time (1h, 30m, 7d)
 */
function parseTimestamp(value: string): number | null {
  if (!value) return null;

  // Unix timestamp (10 digits)
  if (/^\d{10}$/.test(value)) {
    return parseInt(value, 10);
  }

  // Relative time: 1h, 30m, 7d, 2w
  const relativeMatch = value.match(/^(\d+)([smhdw])$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Math.floor(Date.now() / 1000);

    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
    };

    return now - amount * multipliers[unit];
  }

  return null;
}

/**
 * Parse npub, nprofile, or hex pubkey
 * Returns pubkey and optional relay hints from nprofile
 */
function parseNpubOrHex(value: string): {
  pubkey: string | null;
  relays?: string[];
} {
  if (!value) return { pubkey: null };

  // Try to decode npub or nprofile
  if (value.startsWith("npub") || value.startsWith("nprofile")) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === "npub") {
        return { pubkey: decoded.data };
      }
      if (decoded.type === "nprofile") {
        return {
          pubkey: decoded.data.pubkey,
          relays: decoded.data.relays,
        };
      }
    } catch {
      // Not valid npub/nprofile, continue
    }
  }

  // Check if it's hex pubkey
  if (isValidHexPubkey(value)) {
    return { pubkey: normalizeHex(value) };
  }

  return { pubkey: null };
}

/**
 * Parse note1 or hex event ID
 */
function parseNoteOrHex(value: string): string | null {
  if (!value) return null;

  // Try to decode note1
  if (value.startsWith("note")) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === "note") {
        return decoded.data;
      }
    } catch {
      // Not valid note, continue
    }
  }

  // Check if it's hex event ID
  if (isValidHexEventId(value)) {
    return normalizeHex(value);
  }

  return null;
}
