import { getOrComputeCachedValue } from "applesauce-core/helpers";
import {
  getEventPointerFromETag,
  getAddressPointerFromATag,
  getProfilePointerFromPTag,
} from "applesauce-core/helpers/pointers";
import type { NostrEvent } from "nostr-tools";
import type {
  EventPointer,
  AddressPointer,
  ProfilePointer,
} from "nostr-tools/nip19";

// Re-export NIP-73 helpers for backwards compatibility
export {
  getExternalIdentifierIcon,
  getExternalIdentifierLabel,
} from "./nip73-helpers";

// --- Types ---

export type CommentExternalPointer = {
  type: "external";
  value: string;
  hint?: string;
};

export type CommentScope =
  | ({ type: "event" } & EventPointer)
  | ({ type: "address" } & AddressPointer)
  | CommentExternalPointer;

export type CommentRootScope = {
  scope: CommentScope;
  kind: string; // K tag value — a number string or external type like "web"
  author?: ProfilePointer;
};

export type CommentParent = {
  scope: CommentScope;
  kind: string; // k tag value
  author?: ProfilePointer;
};

// --- Cache symbols ---

const RootScopeSymbol = Symbol("nip22RootScope");
const ParentSymbol = Symbol("nip22Parent");
const IsTopLevelSymbol = Symbol("nip22IsTopLevel");

// --- Parsing helpers ---

function findTag(event: NostrEvent, tagName: string): string[] | undefined {
  return event.tags.find((t: string[]) => t[0] === tagName);
}

/**
 * Parse scope from E/e, A/a, I/i tags using applesauce helpers.
 * The helpers work on the tag array structure regardless of tag name casing.
 */
function parseScopeFromTags(
  event: NostrEvent,
  eTagName: string,
  aTagName: string,
  iTagName: string,
): CommentScope | null {
  // Check E/e tag — use applesauce helper for structured parsing
  const eTagData = findTag(event, eTagName);
  if (eTagData) {
    const pointer = getEventPointerFromETag(eTagData);
    if (pointer) {
      return { type: "event", ...pointer };
    }
  }

  // Check A/a tag — use applesauce helper for coordinate parsing
  const aTagData = findTag(event, aTagName);
  if (aTagData) {
    const pointer = getAddressPointerFromATag(aTagData);
    if (pointer) {
      return { type: "address", ...pointer };
    }
  }

  // Check I/i tag — external identifiers (no applesauce helper for this)
  const iTagData = findTag(event, iTagName);
  if (iTagData && iTagData[1]) {
    return {
      type: "external",
      value: iTagData[1],
      hint: iTagData[2] || undefined,
    };
  }

  return null;
}

/**
 * Parse an author tag (P/p) using applesauce helper.
 */
function parseAuthorTag(
  event: NostrEvent,
  tagName: string,
): ProfilePointer | undefined {
  const tag = findTag(event, tagName);
  if (!tag) return undefined;
  return getProfilePointerFromPTag(tag) ?? undefined;
}

// --- Public API ---

/**
 * Get the root scope of a NIP-22 comment (uppercase E/A/I + K + P tags).
 * This tells you what the comment thread is *about* (a blog post, file, URL, podcast, etc.).
 */
export function getCommentRootScope(
  event: NostrEvent,
): CommentRootScope | null {
  return getOrComputeCachedValue(event, RootScopeSymbol, () => {
    const scope = parseScopeFromTags(event, "E", "A", "I");
    if (!scope) return null;

    const kTag = findTag(event, "K");
    if (!kTag || !kTag[1]) return null; // K is mandatory

    const author = parseAuthorTag(event, "P");

    return {
      scope,
      kind: kTag[1],
      author,
    };
  });
}

/**
 * Get the parent item of a NIP-22 comment (lowercase e/a/i + k + p tags).
 * This tells you what this comment is directly replying to.
 */
export function getCommentParent(event: NostrEvent): CommentParent | null {
  return getOrComputeCachedValue(event, ParentSymbol, () => {
    const scope = parseScopeFromTags(event, "e", "a", "i");
    if (!scope) return null;

    const kTag = findTag(event, "k");
    if (!kTag || !kTag[1]) return null; // k is mandatory

    const author = parseAuthorTag(event, "p");

    return {
      scope,
      kind: kTag[1],
      author,
    };
  });
}

/**
 * Returns true when the comment is a top-level comment on the root item
 * (not a reply to another comment). Determined by checking if the parent
 * kind is not "1111".
 */
export function isTopLevelComment(event: NostrEvent): boolean {
  return getOrComputeCachedValue(event, IsTopLevelSymbol, () => {
    const parent = getCommentParent(event);
    if (!parent) return true;
    return parent.kind !== "1111";
  });
}
