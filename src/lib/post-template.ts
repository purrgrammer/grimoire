/**
 * The one place a `post` note is built.
 *
 * The composer needs the note twice: while typing, to show who it will tag and
 * where it will go, and at Publish, to sign it. Both go through
 * {@link buildPostTemplate}, so the recipients the screen explains are read off
 * the same `p` tags that get signed. A second parser over the editor would
 * drift from what applesauce's `setShortTextContent` actually tags.
 *
 * `NoteFactory` extends `Promise`: awaiting it yields the UNSIGNED template,
 * and `factory.sign(signer)` awaits that same settled promise, so the preview
 * and the signature can never disagree about tags or `created_at`.
 *
 * Who a note tags (NIP-27, NIP-18, NIP-10):
 * - `nostr:npub` / `nostr:nprofile` → `p` (applesauce `tagPubkeyMentions`)
 * - `nostr:naddr` → `p` for the address's pubkey (same helper), plus the `a`
 *   tag added here
 * - `nostr:note` / `nostr:nevent` → `q` (applesauce `includeQuoteTags`)
 *
 * Excluding a recipient removes their `p` tag and nothing else. The mention
 * stays in the content and every `q`/`a` tag stays, so the reference still
 * renders; only the tag that notifies them (and that drives inbox delivery)
 * goes. POST has no reply mode, so no `p` tag here is structurally required.
 */
import { NoteFactory } from "applesauce-common/factories";
import { getContentPointers } from "applesauce-core/helpers";
import type { EventTemplate } from "nostr-tools";
import { toApplesauceEmojis } from "@/lib/emoji-helpers";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";
import type { BlobAttachment, EmojiTag } from "@/components/editor/types";

export interface PostAddressRef {
  kind: number;
  pubkey: string;
  identifier: string;
}

export interface PostTemplateInput {
  content: string;
  emojiTags: EmojiTag[];
  blobAttachments: BlobAttachment[];
  addressRefs: PostAddressRef[];
  includeClientTag: boolean;
  /** Pubkeys the user chose not to tag. Their `p` tag is dropped. */
  excludedRecipients?: ReadonlySet<string>;
  /** The note's author: never listed as a recipient. */
  selfPubkey?: string;
}

/** Why a pubkey is tagged. A pubkey can be tagged for several reasons. */
export type RecipientVia = "mention" | "address-author";

export interface PostRecipient {
  pubkey: string;
  via: RecipientVia[];
  /** The user removed this recipient: no `p` tag in the template. */
  excluded: boolean;
}

export interface BuiltPost {
  /** Sign THIS to get the event the template describes. */
  factory: ReturnType<typeof NoteFactory.create>;
  template: EventTemplate;
  /** Everyone the note tags or would tag, minus the author. */
  recipients: PostRecipient[];
}

/** Pubkeys of the `p` tags of a template, in order, deduplicated. */
export function getTaggedPubkeys(template: Pick<EventTemplate, "tags">) {
  return [
    ...new Set(
      template.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]),
    ),
  ];
}

function addVia(
  map: Map<string, RecipientVia[]>,
  pubkey: string,
  via: RecipientVia,
) {
  const list = map.get(pubkey) ?? [];
  if (!list.includes(via)) list.push(via);
  map.set(pubkey, list);
}

/**
 * Build the note for the given editor content. Never signs.
 *
 * Without `excludedRecipients` the tags are exactly what
 * the composer produced before this module existed (see the golden test).
 */
export async function buildPostTemplate(
  input: PostTemplateInput,
): Promise<BuiltPost> {
  const {
    content,
    emojiTags,
    blobAttachments,
    addressRefs,
    includeClientTag,
    excludedRecipients,
    selfPubkey,
  } = input;

  const text = content.trim();
  // Tags applesauce does not add.
  const additionalTags: string[][] = [];
  for (const addr of addressRefs) {
    additionalTags.push([
      "a",
      `${addr.kind}:${addr.pubkey}:${addr.identifier}`,
    ]);
  }
  if (includeClientTag) additionalTags.push(GRIMOIRE_CLIENT_TAG);
  for (const blob of blobAttachments) {
    const imetaTag = [
      "imeta",
      `url ${blob.url}`,
      `m ${blob.mimeType}`,
      `x ${blob.sha256}`,
      `size ${blob.size}`,
    ];
    if (blob.server) imetaTag.push(`server ${blob.server}`);
    additionalTags.push(imetaTag);
  }

  const excluded = excludedRecipients ?? new Set<string>();

  const factory = NoteFactory.create(text, {
    emojis: toApplesauceEmojis(emojiTags),
  }).modifyPublicTags((tags) => {
    let next = [...tags, ...additionalTags];

    if (excluded.size > 0) {
      next = next.filter((t) => !(t[0] === "p" && excluded.has(t[1])));
    }
    return next;
  });

  const template = await factory;

  // Read the mentions off the template's content, not the raw text:
  // applesauce's `repairNostrLinks` turns a bare `npub1…` into `nostr:npub1…`
  // and tags it, so the raw text would undercount.
  const via = new Map<string, RecipientVia[]>();
  for (const pointer of getContentPointers(text)) {
    if (pointer.type === "npub") addVia(via, pointer.data, "mention");
    else if (pointer.type === "nprofile")
      addVia(via, pointer.data.pubkey, "mention");
    else if (pointer.type === "naddr")
      addVia(via, pointer.data.pubkey, "address-author");
  }

  const recipients: PostRecipient[] = [...via.entries()]
    .filter(([pubkey]) => pubkey !== selfPubkey)
    .map(([pubkey, reasons]) => ({
      pubkey,
      via: reasons,
      excluded: excluded.has(pubkey),
    }));

  return { factory, template, recipients };
}
