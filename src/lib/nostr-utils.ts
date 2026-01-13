import type { ProfileContent } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { NostrFilter } from "@/types/nostr";
import { getNip10References } from "applesauce-common/helpers/threading";
import { getCommentReplyPointer } from "applesauce-common/helpers/comment";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";

export function derivePlaceholderName(pubkey: string): string {
  return `${pubkey.slice(0, 4)}:${pubkey.slice(-4)}`;
}

/**
 * Get a reply pointer for an event, abstracting the differences between NIP-10 and NIP-22 (comments).
 */
export function getEventReply(
  event: NostrEvent,
):
  | { type: "root"; pointer: EventPointer | AddressPointer }
  | { type: "reply"; pointer: EventPointer | AddressPointer }
  | { type: "comment"; pointer: any }
  | null {
  // Handle Kind 1 (Text Note) - NIP-10
  if (event.kind === 1) {
    const references = getNip10References(event);
    if (references.reply) {
      const pointer = references.reply.e || references.reply.a;
      if (pointer) return { type: "reply", pointer };
    }
    if (references.root) {
      const pointer = references.root.e || references.root.a;
      if (pointer) return { type: "root", pointer };
    }
  }

  // Handle Kind 1111 (Comment) - NIP-22
  if (event.kind === 1111) {
    const pointer = getCommentReplyPointer(event);
    if (pointer) {
      return { type: "comment", pointer };
    }
  }

  // Fallback for generic replies (using NIP-10 logic for other kinds usually works)
  if (event.kind !== 1111) {
    const references = getNip10References(event);
    if (references.reply) {
      const pointer = references.reply.e || references.reply.a;
      if (pointer) return { type: "reply", pointer };
    }
    if (references.root) {
      const pointer = references.root.e || references.root.a;
      if (pointer) return { type: "root", pointer };
    }
  }

  return null;
}

export function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName && tag[1])
    .map((tag) => tag[1]);
}

/**
 * Symbol used by applesauce to store hidden/decrypted tags on events.
 * These tags are populated after decrypting NIP-51 list content.
 */
const HIDDEN_TAGS_SYMBOL = Symbol.for("hidden-tags");

/**
 * Get all tag values including hidden/encrypted tags (after decryption).
 * This is useful for NIP-51 lists that may have private (encrypted) tags.
 *
 * @param event - Nostr event that may have hidden tags
 * @param tagName - Tag name to extract values for (e.g., "t", "p", "a")
 * @returns Array of all tag values (public + hidden), deduplicated
 */
export function getAllTagValues(event: NostrEvent, tagName: string): string[] {
  // Get public tags
  const publicValues = event.tags
    .filter((tag) => tag[0] === tagName && tag[1])
    .map((tag) => tag[1]);

  // Check for hidden tags (populated by applesauce after decryption)
  const hiddenTags = (event as any)[HIDDEN_TAGS_SYMBOL] as
    | string[][]
    | undefined;

  if (hiddenTags && Array.isArray(hiddenTags)) {
    const hiddenValues = hiddenTags
      .filter((tag) => tag[0] === tagName && tag[1])
      .map((tag) => tag[1]);

    // Deduplicate and combine
    return Array.from(new Set([...publicValues, ...hiddenValues]));
  }

  return publicValues;
}

export function getDisplayName(
  pubkey: string,
  metadata?: ProfileContent,
): string {
  if (metadata?.display_name) {
    return metadata.display_name;
  }
  if (metadata?.name) {
    return metadata.name;
  }
  return derivePlaceholderName(pubkey);
}

/**
 * Options for resolving filter aliases
 */
export interface ResolveFilterAliasesOptions {
  /** Current user's pubkey (for $me resolution) */
  accountPubkey?: string;
  /** Array of contact pubkeys (for $contacts resolution) */
  contacts?: string[];
  /** Array of hashtags from interest list (for $hashtags resolution) */
  hashtags?: string[];
}

/**
 * Resolve $me, $contacts, and $hashtags aliases in a Nostr filter (case-insensitive)
 * @param filter - Filter that may contain aliases
 * @param accountPubkey - Current user's pubkey (for $me resolution) - DEPRECATED, use options
 * @param contacts - Array of contact pubkeys (for $contacts resolution) - DEPRECATED, use options
 * @param options - Options object with all resolution data
 * @returns Resolved filter with aliases replaced by actual values
 */
export function resolveFilterAliases(
  filter: NostrFilter,
  accountPubkey: string | undefined | ResolveFilterAliasesOptions,
  contacts?: string[],
  options?: ResolveFilterAliasesOptions,
): NostrFilter {
  // Support both old signature and new options-based signature
  let opts: ResolveFilterAliasesOptions;
  if (typeof accountPubkey === "object" && accountPubkey !== null) {
    // New signature: resolveFilterAliases(filter, options)
    opts = accountPubkey;
  } else {
    // Old signature: resolveFilterAliases(filter, accountPubkey, contacts, options?)
    opts = {
      accountPubkey: accountPubkey as string | undefined,
      contacts: contacts ?? [],
      ...options,
    };
  }

  const {
    accountPubkey: pubkey,
    contacts: contactList = [],
    hashtags = [],
  } = opts;
  const resolved = { ...filter };

  // Resolve aliases in authors array
  if (resolved.authors && resolved.authors.length > 0) {
    const resolvedAuthors: string[] = [];

    for (const author of resolved.authors) {
      const normalized = author.toLowerCase();
      if (normalized === "$me") {
        if (pubkey) {
          resolvedAuthors.push(pubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedAuthors.push(...contactList);
      } else {
        resolvedAuthors.push(author);
      }
    }

    // Deduplicate
    resolved.authors = Array.from(new Set(resolvedAuthors));
  }

  // Resolve aliases in #p tags array
  if (resolved["#p"] && resolved["#p"].length > 0) {
    const resolvedPTags: string[] = [];

    for (const pTag of resolved["#p"]) {
      const normalized = pTag.toLowerCase();
      if (normalized === "$me") {
        if (pubkey) {
          resolvedPTags.push(pubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedPTags.push(...contactList);
      } else {
        resolvedPTags.push(pTag);
      }
    }

    // Deduplicate
    resolved["#p"] = Array.from(new Set(resolvedPTags));
  }

  // Resolve aliases in #P tags array (uppercase P, e.g., zap senders)
  if (resolved["#P"] && resolved["#P"].length > 0) {
    const resolvedPTagsUppercase: string[] = [];

    for (const pTag of resolved["#P"]) {
      const normalized = pTag.toLowerCase();
      if (normalized === "$me") {
        if (pubkey) {
          resolvedPTagsUppercase.push(pubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedPTagsUppercase.push(...contactList);
      } else {
        resolvedPTagsUppercase.push(pTag);
      }
    }

    // Deduplicate
    resolved["#P"] = Array.from(new Set(resolvedPTagsUppercase));
  }

  // Resolve $hashtags alias in #t tags array
  if (resolved["#t"] && resolved["#t"].length > 0) {
    const resolvedTTags: string[] = [];

    for (const tTag of resolved["#t"]) {
      const normalized = tTag.toLowerCase();
      if (normalized === "$hashtags") {
        resolvedTTags.push(...hashtags);
      } else {
        resolvedTTags.push(tTag);
      }
    }

    // Deduplicate
    const deduped = Array.from(new Set(resolvedTTags));

    // If result is empty, remove #t from filter entirely to avoid unusable query
    if (deduped.length === 0) {
      delete resolved["#t"];
    } else {
      resolved["#t"] = deduped;
    }
  }

  return resolved;
}
