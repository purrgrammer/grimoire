import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";

import { extractMentionTags, mentionsPubkey } from "./mentions";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);
const THIRD = "33".repeat(32);

describe("mentionsPubkey", () => {
  it("finds a p tag naming the reader", () => {
    expect(mentionsPubkey([["p", ME]], ME)).toBe(true);
  });

  it("ignores a p tag naming someone else", () => {
    expect(mentionsPubkey([["p", THEM]], ME)).toBe(false);
  });

  it("ignores an e tag carrying the reader's key", () => {
    expect(mentionsPubkey([["e", ME]], ME)).toBe(false);
  });

  it("matches regardless of the tag's case", () => {
    expect(mentionsPubkey([["p", ME.toUpperCase()]], ME)).toBe(true);
  });

  it("finds the reader among several p tags", () => {
    expect(
      mentionsPubkey(
        [
          ["p", THEM],
          ["e", "aa".repeat(32)],
          ["p", ME],
        ],
        ME,
      ),
    ).toBe(true);
  });

  it("is false with no tags, and false without a reader", () => {
    expect(mentionsPubkey([], ME)).toBe(false);
    expect(mentionsPubkey([["p", ME]], "")).toBe(false);
  });

  it("survives a malformed tag with no value", () => {
    expect(mentionsPubkey([["p"]], ME)).toBe(false);
  });
});

describe("extractMentionTags", () => {
  const npub = (pk: string) => nip19.npubEncode(pk);
  const nprofile = (pk: string) => nip19.nprofileEncode({ pubkey: pk });

  it("tags the pubkey behind an npub reference", () => {
    expect(extractMentionTags(`hi nostr:${npub(THEM)}`)).toEqual([["p", THEM]]);
  });

  it("tags the pubkey behind an nprofile reference", () => {
    expect(extractMentionTags(`hi nostr:${nprofile(THEM)}`)).toEqual([
      ["p", THEM],
    ]);
  });

  it("tags a mentioned person once, however many times they are named", () => {
    const content = `nostr:${npub(THEM)} and again nostr:${nprofile(THEM)}`;
    expect(extractMentionTags(content)).toEqual([["p", THEM]]);
  });

  it("leaves out everyone in the exclude set", () => {
    const content = `nostr:${npub(ME)} nostr:${npub(THEM)} nostr:${npub(THIRD)}`;
    expect(extractMentionTags(content, [ME, THIRD])).toEqual([["p", THEM]]);
  });

  it("ignores something that only looks like a reference", () => {
    expect(extractMentionTags("nostr:npub1notrealbech32")).toEqual([]);
  });

  it("ignores a bare npub with no nostr: URI in front of it", () => {
    // NIP-27 addresses a reference, not a word that happens to be an npub —
    // and the composer always serializes the URI form.
    expect(extractMentionTags(`hi ${npub(THEM)}`)).toEqual([]);
  });

  it("finds a reference glued to the punctuation after it", () => {
    expect(extractMentionTags(`hey nostr:${npub(THEM)}, look`)).toEqual([
      ["p", THEM],
    ]);
  });

  it("writes what mentionsPubkey reads", () => {
    const tags = extractMentionTags(`nostr:${npub(THEM)}`);
    expect(mentionsPubkey(tags, THEM)).toBe(true);
    expect(mentionsPubkey(tags, ME)).toBe(false);
  });
});
