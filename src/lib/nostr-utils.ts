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
 * Resolve $me and $contacts aliases in a Nostr filter (case-insensitive)
 * @param filter - Filter that may contain $me or $contacts aliases
 * @param accountPubkey - Current user's pubkey (for $me resolution)
 * @param contacts - Array of contact pubkeys (for $contacts resolution)
 * @returns Resolved filter with aliases replaced by actual pubkeys
 */
export function resolveFilterAliases(
  filter: NostrFilter,
  accountPubkey: string | undefined,
  contacts: string[],
): NostrFilter {
  const resolved = { ...filter };

  // Resolve aliases in authors array
  if (resolved.authors && resolved.authors.length > 0) {
    const resolvedAuthors: string[] = [];

    for (const author of resolved.authors) {
      const normalized = author.toLowerCase();
      if (normalized === "$me") {
        if (accountPubkey) {
          resolvedAuthors.push(accountPubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedAuthors.push(...contacts);
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
        if (accountPubkey) {
          resolvedPTags.push(accountPubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedPTags.push(...contacts);
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
        if (accountPubkey) {
          resolvedPTagsUppercase.push(accountPubkey);
        }
      } else if (normalized === "$contacts") {
        resolvedPTagsUppercase.push(...contacts);
      } else {
        resolvedPTagsUppercase.push(pTag);
      }
    }

    // Deduplicate
    resolved["#P"] = Array.from(new Set(resolvedPTagsUppercase));
  }

  return resolved;
}
