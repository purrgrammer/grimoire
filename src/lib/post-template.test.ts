import { describe, expect, it } from "vitest";
import { NoteFactory } from "applesauce-common/factories";
import { nip19 } from "nostr-tools";
import { buildPostTemplate, getTaggedPubkeys } from "./post-template";
import { toApplesauceEmojis } from "@/lib/emoji-helpers";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";
import type { BlobAttachment, EmojiTag } from "@/components/editor/types";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const SELF = "f".repeat(64);
const NOTE_ID = "1".repeat(64);
const EVENT_ID = "2".repeat(64);

const npub = (pk: string) => `nostr:${nip19.npubEncode(pk)}`;
const nprofile = (pk: string, relays: string[] = []) =>
  `nostr:${nip19.nprofileEncode({ pubkey: pk, relays })}`;
const nevent = (id: string, author?: string) =>
  `nostr:${nip19.neventEncode({ id, author, kind: 1, relays: ["wss://hint.example.com"] })}`;
const naddr = (pubkey: string) =>
  `nostr:${nip19.naddrEncode({ kind: 30023, pubkey, identifier: "post" })}`;

/**
 * The tag pipeline exactly as `PostViewer.handlePublish` ran it before
 * `buildPostTemplate` existed, minus the signature.
 */
async function legacyTemplate(
  content: string,
  emojiTags: EmojiTag[],
  blobAttachments: BlobAttachment[],
  addressRefs: Array<{ kind: number; pubkey: string; identifier: string }>,
  includeClientTag: boolean,
) {
  const noteDraft = NoteFactory.create(content.trim(), {
    emojis: toApplesauceEmojis(emojiTags),
  });
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
  return noteDraft.modifyPublicTags((tags) => [...tags, ...additionalTags]);
}

const content = [
  `hi ${npub(ALICE)} and ${nprofile(BOB, ["wss://bob-hint.example.com"])}`,
  `quoting nostr:${nip19.noteEncode(NOTE_ID)} and ${nevent(EVENT_ID, CAROL)}`,
  `article ${naddr(CAROL)} #Nostr :wave:`,
  "https://blossom.example.com/abc.png",
].join("\n");
const emojiTags: EmojiTag[] = [
  { shortcode: "wave", url: "https://emoji.example.com/wave.png" },
];
const blobs: BlobAttachment[] = [
  {
    url: "https://blossom.example.com/abc.png",
    sha256: "d".repeat(64),
    mimeType: "image/png",
    size: 42,
    server: "https://blossom.example.com",
  },
];
const addrs = [{ kind: 30023, pubkey: CAROL, identifier: "post" }];

describe("buildPostTemplate", () => {
  it("produces the same tags and content as the composer did before", async () => {
    for (const includeClientTag of [true, false]) {
      const legacy = await legacyTemplate(
        content,
        emojiTags,
        blobs,
        addrs,
        includeClientTag,
      );
      const { template } = await buildPostTemplate({
        content,
        emojiTags,
        blobAttachments: blobs,
        addressRefs: addrs,
        includeClientTag,
      });
      expect(template.kind).toBe(1);
      expect(template.content).toBe(legacy.content);
      expect(template.tags).toEqual(legacy.tags);
    }
  });

  it("signs exactly the template it previewed", async () => {
    const built = await buildPostTemplate({
      content: `hello ${npub(ALICE)}`,
      emojiTags: [],
      blobAttachments: [],
      addressRefs: [],
      includeClientTag: false,
    });
    const signed = await built.factory.sign({
      getPublicKey: async () => SELF,
      signEvent: async (t) => ({ ...t, pubkey: SELF, id: "0", sig: "0" }),
    });
    expect(signed.tags).toEqual(built.template.tags);
    expect(signed.created_at).toBe(built.template.created_at);
    expect(signed.content).toBe(built.template.content);
  });

  it("lists explicit mentions and address authors as recipients", async () => {
    const { recipients, template } = await buildPostTemplate({
      content,
      emojiTags,
      blobAttachments: blobs,
      addressRefs: addrs,
      includeClientTag: false,
    });
    expect(recipients).toEqual([
      { pubkey: ALICE, via: ["mention"], excluded: false },
      { pubkey: BOB, via: ["mention"], excluded: false },
      { pubkey: CAROL, via: ["address-author"], excluded: false },
    ]);
    // The recipients are exactly the p tags.
    expect(getTaggedPubkeys(template).sort()).toEqual(
      recipients.map((r) => r.pubkey).sort(),
    );
  });

  it("tags a bare npub the way applesauce repairs it", async () => {
    const { recipients, template } = await buildPostTemplate({
      content: `hey ${nip19.npubEncode(ALICE)}`,
      emojiTags: [],
      blobAttachments: [],
      addressRefs: [],
      includeClientTag: false,
    });
    expect(getTaggedPubkeys(template)).toEqual([ALICE]);
    expect(recipients.map((r) => r.pubkey)).toEqual([ALICE]);
  });

  it("deduplicates a pubkey mentioned twice", async () => {
    const { recipients, template } = await buildPostTemplate({
      content: `${npub(ALICE)} ${nprofile(ALICE)}`,
      emojiTags: [],
      blobAttachments: [],
      addressRefs: [],
      includeClientTag: false,
    });
    expect(recipients).toHaveLength(1);
    expect(template.tags.filter((t) => t[0] === "p")).toHaveLength(1);
  });

  it("never lists the author, but keeps a self-mention's p tag", async () => {
    const { recipients, template } = await buildPostTemplate({
      content: `me ${npub(SELF)} and ${npub(ALICE)}`,
      emojiTags: [],
      blobAttachments: [],
      addressRefs: [],
      includeClientTag: false,
      selfPubkey: SELF,
    });
    expect(recipients.map((r) => r.pubkey)).toEqual([ALICE]);
    expect(getTaggedPubkeys(template)).toEqual([SELF, ALICE]);
  });

  it("drops only the excluded recipient's p tag and keeps the reference", async () => {
    const { recipients, template } = await buildPostTemplate({
      content,
      emojiTags,
      blobAttachments: blobs,
      addressRefs: addrs,
      includeClientTag: false,
      excludedRecipients: new Set([CAROL]),
    });
    expect(getTaggedPubkeys(template)).toEqual([ALICE, BOB]);
    expect(recipients.find((r) => r.pubkey === CAROL)?.excluded).toBe(true);
    // The naddr stays in the content and its a tag stays.
    expect(template.content).toContain(naddr(CAROL));
    expect(template.tags).toContainEqual(["a", `30023:${CAROL}:post`]);
    // Quotes are untouched.
    expect(template.tags.some((t) => t[0] === "q" && t[1] === EVENT_ID)).toBe(
      true,
    );
  });

  describe("quoted notes' authors (NIP-10, NIP-18)", () => {
    const quoteContent = `look nostr:${nip19.noteEncode(NOTE_ID)} and ${nevent(EVENT_ID, CAROL)}`;
    const base = {
      content: quoteContent,
      emojiTags: [],
      blobAttachments: [],
      addressRefs: [],
      includeClientTag: false,
      selfPubkey: SELF,
    };

    it("does not tag an author from an nevent hint alone", async () => {
      const { template, recipients, quotes } = await buildPostTemplate(base);
      expect(getTaggedPubkeys(template)).toEqual([]);
      expect(recipients).toEqual([]);
      // applesauce's q tag, untouched: the hinted author stays in its slot.
      expect(template.tags).toContainEqual([
        "q",
        EVENT_ID,
        "wss://hint.example.com",
        CAROL,
      ]);
      expect(quotes.map((q) => [q.id, q.hintedAuthor, q.author])).toEqual([
        [NOTE_ID, undefined, undefined],
        [EVENT_ID, CAROL, undefined],
      ]);
    });

    it("tags a verified author and fills the q tag's pubkey", async () => {
      const { template, recipients } = await buildPostTemplate({
        ...base,
        quoteAuthors: new Map([[NOTE_ID, ALICE]]),
      });
      expect(template.tags).toContainEqual(["q", NOTE_ID, "", ALICE]);
      expect(getTaggedPubkeys(template)).toEqual([ALICE]);
      expect(recipients).toEqual([
        { pubkey: ALICE, via: ["quote-author"], excluded: false },
      ]);
    });

    it("lets the verified author win over a contradicting nevent hint", async () => {
      const { template } = await buildPostTemplate({
        ...base,
        quoteAuthors: new Map([[EVENT_ID, BOB]]),
      });
      expect(template.tags).toContainEqual([
        "q",
        EVENT_ID,
        "wss://hint.example.com",
        BOB,
      ]);
      expect(getTaggedPubkeys(template)).toEqual([BOB]);
    });

    it("merges a person both mentioned and quoted into one recipient", async () => {
      const { template, recipients } = await buildPostTemplate({
        ...base,
        content: `${npub(ALICE)} ${quoteContent}`,
        quoteAuthors: new Map([[NOTE_ID, ALICE]]),
      });
      expect(template.tags.filter((t) => t[0] === "p")).toHaveLength(1);
      expect(recipients).toEqual([
        { pubkey: ALICE, via: ["mention", "quote-author"], excluded: false },
      ]);
    });

    it("adds no p tag for a quote of your own note", async () => {
      const { template, recipients } = await buildPostTemplate({
        ...base,
        quoteAuthors: new Map([[NOTE_ID, SELF]]),
      });
      expect(getTaggedPubkeys(template)).toEqual([]);
      expect(recipients).toEqual([]);
      expect(template.tags).toContainEqual(["q", NOTE_ID, "", SELF]);
    });

    it("untagging a quoted author keeps the q tag", async () => {
      const { template, recipients } = await buildPostTemplate({
        ...base,
        quoteAuthors: new Map([[NOTE_ID, ALICE]]),
        excludedRecipients: new Set([ALICE]),
      });
      expect(getTaggedPubkeys(template)).toEqual([]);
      expect(template.tags).toContainEqual(["q", NOTE_ID, "", ALICE]);
      expect(recipients[0].excluded).toBe(true);
    });

    it("covers a bare note1 that applesauce repairs", async () => {
      const { template } = await buildPostTemplate({
        ...base,
        content: `see ${nip19.noteEncode(NOTE_ID)}`,
        quoteAuthors: new Map([[NOTE_ID, ALICE]]),
      });
      expect(getTaggedPubkeys(template)).toEqual([ALICE]);
    });
  });
});
