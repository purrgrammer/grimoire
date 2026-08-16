import { describe, expect, it } from "vitest";
import {
  getParsedContent,
  textNoteTransformers,
} from "applesauce-content/text";
import { nip19 } from "nostr-tools";

import { bareNostrMentions } from "@/lib/bare-mention-transformer";

// The order RichText registers, without dragging its component tree in: the
// built-ins first, this transformer after them.
const transformers = [...textNoteTransformers, bareNostrMentions];

const EVENT_ID = "a".repeat(64);
const nevent = nip19.neventEncode({ id: EVENT_ID, kind: 1 });

/** Node types in document order, one level deep. */
function parse(content: string) {
  const tree = getParsedContent(
    content,
    undefined,
    transformers,
    Symbol.for(`bare-mention-test:${content}`),
  );
  return (tree.children ?? []) as Array<{
    type: string;
    value?: string;
    href?: string;
  }>;
}

describe("bare NIP-19 references", () => {
  it("resolves an id glued to the word before it", () => {
    // Verbatim shape of the real message that surfaced this: a sentence ending
    // in a period, with the id run straight on.
    const nodes = parse(`want to see it.${nevent}`);
    expect(nodes.map((n) => n.type)).toContain("mention");
  });

  it("still resolves the ordinary whitespace-separated form", () => {
    const nodes = parse(`look at nostr:${nevent} here`);
    expect(nodes.filter((n) => n.type === "mention")).toHaveLength(1);
  });

  it("leaves an id inside a URL as one link", () => {
    // The whole point of the boundary rule this relaxes. Order is what
    // preserves it: `links` runs first and consumes the URL entirely.
    const nodes = parse(`https://ditto.pub/${nevent}`);
    expect(nodes.map((n) => n.type)).toEqual(["link"]);
    expect(nodes[0].href).toContain(nevent);
  });

  it("leaves text that merely looks like an id alone", () => {
    const nodes = parse("npub1notarealidentifier");
    expect(nodes.map((n) => n.type)).toEqual(["text"]);
  });
});
