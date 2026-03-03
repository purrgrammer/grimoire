/**
 * Local copies of applesauce-common blueprints with NIP-30 emoji set address support.
 *
 * The upstream Emoji type only has { shortcode, url }. NIP-30 allows an optional 4th
 * tag parameter for the emoji set address (e.g. "30030:pubkey:identifier"). These
 * blueprints add that via a local `EmojiWithAddress` type and a custom `includeEmojis`
 * operation. A patch upstream will be submitted once stable.
 *
 * TODO: Once applesauce-common supports the emoji set address natively, remove this
 * file and revert all imports back to `applesauce-common/blueprints`.
 */

import { blueprint } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import {
  setShortTextContent,
  type TextContentOptions,
} from "applesauce-core/operations/content";
import {
  setMetaTags,
  type MetaTagOptions,
} from "applesauce-core/operations/event";
import type { EventOperation } from "applesauce-core/event-factory";
import {
  setZapSplit,
  type ZapOptions,
} from "applesauce-common/operations/zap-split";
import {
  includePubkeyNotificationTags,
  setThreadParent,
} from "applesauce-common/operations/note";
import {
  addPreviousRefs,
  setGroupPointer,
} from "applesauce-common/operations/group";
import {
  setReaction,
  setReactionParent,
} from "applesauce-common/operations/reaction";
import {
  GROUP_MESSAGE_KIND,
  type GroupPointer,
} from "applesauce-common/helpers/groups";
import type { NostrEvent } from "nostr-tools";

// ---------------------------------------------------------------------------
// Extended emoji type
// ---------------------------------------------------------------------------

export type EmojiWithAddress = {
  shortcode: string;
  url: string;
  /** NIP-30 optional 4th tag: the "30030:pubkey:identifier" address of the set */
  address?: string;
};

// ---------------------------------------------------------------------------
// Custom includeEmojis operation that writes the 4th address param when present
// ---------------------------------------------------------------------------

const Expressions = {
  emoji: /:([a-zA-Z0-9_-]+):/g,
};

function includeEmojisWithAddress(emojis: EmojiWithAddress[]): EventOperation {
  return (draft, ctx) => {
    // Merge context emojis (upstream compat) with explicitly passed emojis
    const all: EmojiWithAddress[] = [
      ...(ctx.emojis ?? []).map((e) => ({
        shortcode: e.shortcode,
        url: e.url,
      })),
      ...emojis,
    ];
    const emojiTags = Array.from(
      draft.content.matchAll(Expressions.emoji),
      ([, name]) => {
        const emoji = all.find((e) => e.shortcode === name);
        if (!emoji?.url) return null;
        return emoji.address
          ? ["emoji", emoji.shortcode, emoji.url, emoji.address]
          : ["emoji", emoji.shortcode, emoji.url];
      },
    ).filter((tag): tag is string[] => tag !== null);
    return { ...draft, tags: [...draft.tags, ...emojiTags] };
  };
}

// TextContentOptions extended with our emoji type
export type TextContentOptionsWithAddress = Omit<
  TextContentOptions,
  "emojis"
> & {
  emojis?: EmojiWithAddress[];
};

// MetaTagOptions extended (MetaTagOptions doesn't use emojis, but we carry the same pattern)
export type NoteBlueprintOptions = TextContentOptionsWithAddress &
  MetaTagOptions &
  ZapOptions;

// ---------------------------------------------------------------------------
// NoteBlueprint
// ---------------------------------------------------------------------------

export function NoteBlueprint(content: string, options?: NoteBlueprintOptions) {
  return blueprint(
    kinds.ShortTextNote,
    // set text content (without emoji — we handle it ourselves)
    setShortTextContent(content, { ...options, emojis: undefined }),
    options?.emojis ? includeEmojisWithAddress(options.emojis) : undefined,
    setZapSplit(options),
    setMetaTags(options),
  );
}

// ---------------------------------------------------------------------------
// NoteReplyBlueprint
// ---------------------------------------------------------------------------

export function NoteReplyBlueprint(
  parent: NostrEvent,
  content: string,
  options?: TextContentOptionsWithAddress,
) {
  if (parent.kind !== kinds.ShortTextNote)
    throw new Error(
      "Kind 1 replies should only be used to reply to kind 1 notes",
    );
  return blueprint(
    kinds.ShortTextNote,
    setThreadParent(parent),
    includePubkeyNotificationTags(parent),
    setShortTextContent(content, { ...options, emojis: undefined }),
    options?.emojis ? includeEmojisWithAddress(options.emojis) : undefined,
  );
}

// ---------------------------------------------------------------------------
// GroupMessageBlueprint
// ---------------------------------------------------------------------------

export type GroupMessageOptions = TextContentOptionsWithAddress &
  MetaTagOptions & {
    previous?: NostrEvent[];
  };

export function GroupMessageBlueprint(
  group: GroupPointer,
  content: string,
  options?: GroupMessageOptions,
) {
  return blueprint(
    GROUP_MESSAGE_KIND,
    setGroupPointer(group),
    options?.previous ? addPreviousRefs(options.previous) : undefined,
    setShortTextContent(content, { ...options, emojis: undefined }),
    options?.emojis ? includeEmojisWithAddress(options.emojis) : undefined,
    setMetaTags(options),
  );
}

// ---------------------------------------------------------------------------
// ReactionBlueprint
// ---------------------------------------------------------------------------

export function ReactionBlueprint(
  event: NostrEvent,
  emoji: string | EmojiWithAddress = "+",
) {
  return blueprint(
    kinds.Reaction,
    setReaction(
      typeof emoji === "string"
        ? emoji
        : { shortcode: emoji.shortcode, url: emoji.url },
    ),
    setReactionParent(event),
    typeof emoji !== "string" ? includeEmojisWithAddress([emoji]) : undefined,
  );
}
