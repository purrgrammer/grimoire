import { nip19 } from "nostr-tools";
import type { NostrFilter } from "@/types/nostr";
import { isNip05, isDomain } from "./nip05";
import {
  isValidHexPubkey,
  isValidHexEventId,
  normalizeHex,
} from "./nostr-validation";
import { normalizeRelayURL } from "./relay-url";

export interface ParsedCountCommand {
  filter: NostrFilter;
  relays: string[]; // Required - at least one relay
  nip05Authors?: string[];
  nip05PTags?: string[];
  nip05PTagsUppercase?: string[];
  domainAuthors?: string[];
  domainPTags?: string[];
  domainPTagsUppercase?: string[];
  needsAccount?: boolean;
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
 * Parse COUNT command arguments into a Nostr filter
 * Similar to REQ but:
 * - Requires at least one relay
 * - No --limit flag (COUNT returns total, not a subset)
 * - No --close-on-eose flag (COUNT is inherently one-shot)
 * - No --view flag (COUNT doesn't render events)
 *
 * Supports:
 * - Filters: -k (kinds), -a (authors), -e (events), -p (#p), -P (#P), -t (#t), -d (#d), --tag/-T (any #tag)
 * - Time: --since, --until
 * - Search: --search
 * - Relays: wss://relay.com or relay.com (required, at least one)
 */
export function parseCountCommand(args: string[]): ParsedCountCommand {
  const filter: NostrFilter = {};
  const relays: string[] = [];
  const nip05Authors = new Set<string>();
  const nip05PTags = new Set<string>();
  const nip05PTagsUppercase = new Set<string>();
  const domainAuthors = new Set<string>();
  const domainPTags = new Set<string>();
  const domainPTagsUppercase = new Set<string>();

  // Use sets for deduplication during accumulation
  const kinds = new Set<number>();
  const authors = new Set<string>();
  const ids = new Set<string>();
  const eventIds = new Set<string>();
  const aTags = new Set<string>();
  const pTags = new Set<string>();
  const pTagsUppercase = new Set<string>();
  const tTags = new Set<string>();
  const dTags = new Set<string>();

  // Map for arbitrary single-letter tags: letter -> Set<value>
  const genericTags = new Map<string, Set<string>>();

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
          if (!nextArg) {
            i++;
            break;
          }
          let addedAny = false;
          const values = nextArg.split(",").map((a) => a.trim());
          for (const authorStr of values) {
            if (!authorStr) continue;
            const normalized = authorStr.toLowerCase();
            if (normalized === "$me" || normalized === "$contacts") {
              authors.add(normalized);
              addedAny = true;
            } else if (authorStr.startsWith("@")) {
              const domain = authorStr.slice(1);
              if (isDomain(domain)) {
                domainAuthors.add(domain);
                addedAny = true;
              }
            } else if (isNip05(authorStr)) {
              nip05Authors.add(authorStr);
              addedAny = true;
            } else {
              const result = parseNpubOrHex(authorStr);
              if (result.pubkey) {
                authors.add(result.pubkey);
                addedAny = true;
                if (result.relays) {
                  relays.push(...result.relays.map(normalizeRelayURL));
                }
              }
            }
          }
          i += addedAny ? 2 : 1;
          break;
        }

        case "-e": {
          if (!nextArg) {
            i++;
            break;
          }

          let addedAny = false;
          const values = nextArg.split(",").map((v) => v.trim());

          for (const val of values) {
            if (!val) continue;

            const parsed = parseEventIdentifier(val);
            if (parsed) {
              if (parsed.type === "direct-event") {
                ids.add(parsed.value);
              } else if (parsed.type === "direct-address") {
                aTags.add(parsed.value);
              } else if (parsed.type === "tag-event") {
                eventIds.add(parsed.value);
              }

              if (parsed.relays) {
                relays.push(...parsed.relays);
              }

              addedAny = true;
            }
          }

          i += addedAny ? 2 : 1;
          break;
        }

        case "-p": {
          if (!nextArg) {
            i++;
            break;
          }
          let addedAny = false;
          const values = nextArg.split(",").map((p) => p.trim());
          for (const pubkeyStr of values) {
            if (!pubkeyStr) continue;
            const normalized = pubkeyStr.toLowerCase();
            if (normalized === "$me" || normalized === "$contacts") {
              pTags.add(normalized);
              addedAny = true;
            } else if (pubkeyStr.startsWith("@")) {
              const domain = pubkeyStr.slice(1);
              if (isDomain(domain)) {
                domainPTags.add(domain);
                addedAny = true;
              }
            } else if (isNip05(pubkeyStr)) {
              nip05PTags.add(pubkeyStr);
              addedAny = true;
            } else {
              const result = parseNpubOrHex(pubkeyStr);
              if (result.pubkey) {
                pTags.add(result.pubkey);
                addedAny = true;
                if (result.relays) {
                  relays.push(...result.relays.map(normalizeRelayURL));
                }
              }
            }
          }
          i += addedAny ? 2 : 1;
          break;
        }

        case "-P": {
          if (!nextArg) {
            i++;
            break;
          }
          let addedAny = false;
          const values = nextArg.split(",").map((p) => p.trim());
          for (const pubkeyStr of values) {
            if (!pubkeyStr) continue;
            const normalized = pubkeyStr.toLowerCase();
            if (normalized === "$me" || normalized === "$contacts") {
              pTagsUppercase.add(normalized);
              addedAny = true;
            } else if (pubkeyStr.startsWith("@")) {
              const domain = pubkeyStr.slice(1);
              if (isDomain(domain)) {
                domainPTagsUppercase.add(domain);
                addedAny = true;
              }
            } else if (isNip05(pubkeyStr)) {
              nip05PTagsUppercase.add(pubkeyStr);
              addedAny = true;
            } else {
              const result = parseNpubOrHex(pubkeyStr);
              if (result.pubkey) {
                pTagsUppercase.add(result.pubkey);
                addedAny = true;
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
          if (nextArg) {
            const addedAny = parseCommaSeparated(nextArg, (v) => v, tTags);
            i += addedAny ? 2 : 1;
          } else {
            i++;
          }
          break;
        }

        case "-d": {
          if (nextArg) {
            const addedAny = parseCommaSeparated(nextArg, (v) => v, dTags);
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

        case "-T":
        case "--tag": {
          if (!nextArg) {
            i++;
            break;
          }

          const letter = nextArg;
          const valueArg = args[i + 2];

          if (letter.length !== 1 || !valueArg) {
            i++;
            break;
          }

          let tagSet = genericTags.get(letter);
          if (!tagSet) {
            tagSet = new Set<string>();
            genericTags.set(letter, tagSet);
          }

          const addedAny = parseCommaSeparated(valueArg, (v) => v, tagSet);

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

  // Validate that at least one relay is specified
  if (relays.length === 0) {
    throw new Error("At least one relay is required for COUNT");
  }

  // Convert accumulated sets to filter arrays
  if (kinds.size > 0) filter.kinds = Array.from(kinds);
  if (authors.size > 0) filter.authors = Array.from(authors);
  if (ids.size > 0) filter.ids = Array.from(ids);
  if (eventIds.size > 0) filter["#e"] = Array.from(eventIds);
  if (aTags.size > 0) filter["#a"] = Array.from(aTags);
  if (pTags.size > 0) filter["#p"] = Array.from(pTags);
  if (pTagsUppercase.size > 0) filter["#P"] = Array.from(pTagsUppercase);
  if (tTags.size > 0) filter["#t"] = Array.from(tTags);
  if (dTags.size > 0) filter["#d"] = Array.from(dTags);

  // Convert generic tags to filter
  for (const [letter, tagSet] of genericTags.entries()) {
    if (tagSet.size > 0) {
      (filter as any)[`#${letter}`] = Array.from(tagSet);
    }
  }

  // Check if filter contains $me or $contacts aliases
  const needsAccount =
    filter.authors?.some((a) => a === "$me" || a === "$contacts") ||
    filter["#p"]?.some((p) => p === "$me" || p === "$contacts") ||
    filter["#P"]?.some((p) => p === "$me" || p === "$contacts") ||
    false;

  // Deduplicate relays
  const uniqueRelays = [...new Set(relays)];

  return {
    filter,
    relays: uniqueRelays,
    nip05Authors: nip05Authors.size > 0 ? Array.from(nip05Authors) : undefined,
    nip05PTags: nip05PTags.size > 0 ? Array.from(nip05PTags) : undefined,
    nip05PTagsUppercase:
      nip05PTagsUppercase.size > 0
        ? Array.from(nip05PTagsUppercase)
        : undefined,
    domainAuthors:
      domainAuthors.size > 0 ? Array.from(domainAuthors) : undefined,
    domainPTags: domainPTags.size > 0 ? Array.from(domainPTags) : undefined,
    domainPTagsUppercase:
      domainPTagsUppercase.size > 0
        ? Array.from(domainPTagsUppercase)
        : undefined,
    needsAccount,
  };
}

/**
 * Check if a string looks like a relay domain
 */
function isRelayDomain(value: string): boolean {
  if (!value || value.startsWith("-")) return false;
  return /^[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(value);
}

/**
 * Parse timestamp - supports unix timestamp, relative time, or "now"
 */
function parseTimestamp(value: string): number | null {
  if (!value) return null;

  if (value.toLowerCase() === "now") {
    return Math.floor(Date.now() / 1000);
  }

  if (value.toLowerCase() === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor(today.getTime() / 1000);
  }

  if (/^\d{10}$/.test(value)) {
    return parseInt(value, 10);
  }

  const relativeMatch = value.match(/^(\d+)(s|m|h|d|w|mo|y)$/);
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
      mo: 2592000,
      y: 31536000,
    };

    return now - amount * multipliers[unit];
  }

  return null;
}

/**
 * Parse npub, nprofile, or hex pubkey
 */
function parseNpubOrHex(value: string): {
  pubkey: string | null;
  relays?: string[];
} {
  if (!value) return { pubkey: null };

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
      // Not valid npub/nprofile
    }
  }

  if (isValidHexPubkey(value)) {
    return { pubkey: normalizeHex(value) };
  }

  return { pubkey: null };
}

interface ParsedEventIdentifier {
  type: "direct-event" | "direct-address" | "tag-event";
  value: string;
  relays?: string[];
}

/**
 * Parse event identifier - supports note, nevent, naddr, and hex event ID
 */
function parseEventIdentifier(value: string): ParsedEventIdentifier | null {
  if (!value) return null;

  if (value.startsWith("nevent")) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === "nevent") {
        return {
          type: "direct-event",
          value: decoded.data.id,
          relays: decoded.data.relays
            ?.map((url) => {
              try {
                return normalizeRelayURL(url);
              } catch {
                return null;
              }
            })
            .filter((url): url is string => url !== null),
        };
      }
    } catch {
      // Not valid nevent
    }
  }

  if (value.startsWith("naddr")) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === "naddr") {
        const coordinate = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
        return {
          type: "direct-address",
          value: coordinate,
          relays: decoded.data.relays
            ?.map((url) => {
              try {
                return normalizeRelayURL(url);
              } catch {
                return null;
              }
            })
            .filter((url): url is string => url !== null),
        };
      }
    } catch {
      // Not valid naddr
    }
  }

  if (value.startsWith("note")) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === "note") {
        return {
          type: "tag-event",
          value: decoded.data,
        };
      }
    } catch {
      // Not valid note
    }
  }

  if (isValidHexEventId(value)) {
    return {
      type: "tag-event",
      value: normalizeHex(value),
    };
  }

  return null;
}
