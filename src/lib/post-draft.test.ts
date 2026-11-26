import { describe, expect, it } from "vitest";
import { parsePostDraft, postDraftKey, serializePostDraft } from "./post-draft";

const PK = "a".repeat(64);

describe("postDraftKey", () => {
  it("keeps the v1 key shape so existing drafts are found", () => {
    expect(postDraftKey(PK)).toBe(`grimoire-post-draft-${PK}`);
    expect(postDraftKey(PK, "w1")).toBe(`grimoire-post-draft-${PK}-w1`);
  });
});

describe("parsePostDraft", () => {
  it("returns null for nothing or unreadable JSON", () => {
    expect(parsePostDraft(null)).toBeNull();
    expect(parsePostDraft("{not json")).toBeNull();
    expect(parsePostDraft("42")).toBeNull();
  });

  it("round-trips a v2 draft", () => {
    const raw = serializePostDraft(
      {
        editorState: { type: "doc" },
        overrides: { "wss://a.example.com/": false },
        addedRelays: ["wss://b.example.com/"],
        excludedRecipients: [PK],
      },
      7,
    );
    expect(parsePostDraft(raw)).toEqual({
      version: 2,
      editorState: { type: "doc" },
      overrides: { "wss://a.example.com/": false },
      addedRelays: ["wss://b.example.com/"],
      excludedRecipients: [PK],
      timestamp: 7,
    });
  });

  it("drops malformed v2 fields instead of failing the whole draft", () => {
    const draft = parsePostDraft(
      JSON.stringify({
        version: 2,
        editorState: { type: "doc" },
        overrides: {
          "wss://a.example.com": "yes",
          "wss://b.example.com": true,
        },
        addedRelays: ["wss://c.example.com", 3, "nope nope"],
        excludedRecipients: ["short", PK, PK],
      }),
    );
    expect(draft?.overrides).toEqual({ "wss://b.example.com/": true });
    expect(draft?.addedRelays).toEqual(["wss://c.example.com/"]);
    expect(draft?.excludedRecipients).toEqual([PK]);
    expect(draft?.editorState).toEqual({ type: "doc" });
  });

  describe("migrating v1", () => {
    const v1 = {
      editorState: { type: "doc", content: [] },
      selectedRelays: ["wss://write.example.com/", "wss://kept.example.com/"],
      addedRelays: ["wss://kept.example.com/", "wss://unticked.example.com/"],
      timestamp: 5,
    };

    it("keeps the content, the added relays and the timestamp", () => {
      const draft = parsePostDraft(JSON.stringify(v1));
      expect(draft?.version).toBe(2);
      expect(draft?.editorState).toEqual(v1.editorState);
      expect(draft?.addedRelays).toEqual(v1.addedRelays);
      expect(draft?.timestamp).toBe(5);
      expect(draft?.excludedRecipients).toEqual([]);
    });

    it("turns an unticked added relay into an off override, and nothing else", () => {
      const draft = parsePostDraft(JSON.stringify(v1));
      // A write relay absent from selectedRelays is ambiguous (unticked, or
      // not in the account list yet), so it is not turned off.
      expect(draft?.overrides).toEqual({
        "wss://unticked.example.com/": false,
      });
    });

    it("invents no override when selectedRelays is missing", () => {
      const { selectedRelays: _drop, ...noSelection } = v1;
      void _drop;
      expect(parsePostDraft(JSON.stringify(noSelection))?.overrides).toEqual(
        {},
      );
    });
  });
});
