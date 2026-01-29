/**
 * Tests for Kind 1 Note Event Builder
 */

import { describe, it, expect } from "vitest";
import { buildNoteDraft } from "./note-builder";
import type { ComposerInput } from "@/components/composer";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

// Helper to create minimal input
function createInput(overrides: Partial<ComposerInput> = {}): ComposerInput {
  return {
    content: "Hello, world!",
    emojiTags: [],
    blobAttachments: [],
    addressRefs: [],
    ...overrides,
  };
}

describe("buildNoteDraft", () => {
  describe("basic event structure", () => {
    it("should create a kind 1 event", async () => {
      const input = createInput();
      const draft = await buildNoteDraft(input);

      expect(draft.kind).toBe(1);
    });

    it("should include content in the event", async () => {
      const input = createInput({ content: "Test content here" });
      const draft = await buildNoteDraft(input);

      expect(draft.content).toBe("Test content here");
    });

    it("should have created_at timestamp", async () => {
      const before = Math.floor(Date.now() / 1000);
      const input = createInput();
      const draft = await buildNoteDraft(input);
      const after = Math.floor(Date.now() / 1000) + 1; // +1 second buffer for timing

      expect(draft.created_at).toBeGreaterThanOrEqual(before);
      expect(draft.created_at).toBeLessThanOrEqual(after);
    });
  });

  describe("hashtag extraction", () => {
    it("should extract hashtags from content", async () => {
      const input = createInput({ content: "Hello #nostr #test" });
      const draft = await buildNoteDraft(input);

      const tTags = draft.tags.filter((t) => t[0] === "t");
      expect(tTags).toContainEqual(["t", "nostr"]);
      expect(tTags).toContainEqual(["t", "test"]);
    });

    it("should normalize hashtags to lowercase", async () => {
      const input = createInput({ content: "Hello #NOSTR #Test" });
      const draft = await buildNoteDraft(input);

      const tTags = draft.tags.filter((t) => t[0] === "t");
      expect(tTags).toContainEqual(["t", "nostr"]);
      expect(tTags).toContainEqual(["t", "test"]);
    });
  });

  describe("emoji tags", () => {
    it("should include custom emoji tags", async () => {
      const input = createInput({
        content: "Hello :wave:",
        emojiTags: [{ shortcode: "wave", url: "https://example.com/wave.png" }],
      });
      const draft = await buildNoteDraft(input);

      const emojiTags = draft.tags.filter((t) => t[0] === "emoji");
      expect(emojiTags).toContainEqual([
        "emoji",
        "wave",
        "https://example.com/wave.png",
      ]);
    });

    it("should include multiple emoji tags", async () => {
      const input = createInput({
        content: "Hello :wave: :smile:",
        emojiTags: [
          { shortcode: "wave", url: "https://example.com/wave.png" },
          { shortcode: "smile", url: "https://example.com/smile.png" },
        ],
      });
      const draft = await buildNoteDraft(input);

      const emojiTags = draft.tags.filter((t) => t[0] === "emoji");
      expect(emojiTags).toHaveLength(2);
    });
  });

  describe("subject tag (title)", () => {
    it("should add subject tag when title is provided", async () => {
      const input = createInput({ title: "My Post Title" });
      const draft = await buildNoteDraft(input);

      const subjectTag = draft.tags.find((t) => t[0] === "subject");
      expect(subjectTag).toEqual(["subject", "My Post Title"]);
    });

    it("should not add subject tag when title is undefined", async () => {
      const input = createInput({ title: undefined });
      const draft = await buildNoteDraft(input);

      const subjectTag = draft.tags.find((t) => t[0] === "subject");
      expect(subjectTag).toBeUndefined();
    });

    it("should not add subject tag when title is empty string", async () => {
      const input = createInput({ title: "" });
      const draft = await buildNoteDraft(input);

      const subjectTag = draft.tags.find((t) => t[0] === "subject");
      expect(subjectTag).toBeUndefined();
    });
  });

  describe("address references (a tags)", () => {
    it("should add a tag for address references", async () => {
      const input = createInput({
        addressRefs: [
          {
            kind: 30023,
            pubkey: "abc123pubkey",
            identifier: "my-article",
          },
        ],
      });
      const draft = await buildNoteDraft(input);

      const aTags = draft.tags.filter((t) => t[0] === "a");
      expect(aTags).toContainEqual(["a", "30023:abc123pubkey:my-article"]);
    });

    it("should add multiple a tags for multiple references", async () => {
      const input = createInput({
        addressRefs: [
          { kind: 30023, pubkey: "author1", identifier: "article-1" },
          { kind: 30818, pubkey: "author2", identifier: "wiki-page" },
        ],
      });
      const draft = await buildNoteDraft(input);

      const aTags = draft.tags.filter((t) => t[0] === "a");
      expect(aTags).toHaveLength(2);
      expect(aTags).toContainEqual(["a", "30023:author1:article-1"]);
      expect(aTags).toContainEqual(["a", "30818:author2:wiki-page"]);
    });
  });

  describe("client tag", () => {
    it("should include client tag when option is true", async () => {
      const input = createInput();
      const draft = await buildNoteDraft(input, { includeClientTag: true });

      const clientTag = draft.tags.find((t) => t[0] === "client");
      expect(clientTag).toEqual(GRIMOIRE_CLIENT_TAG);
    });

    it("should not include client tag when option is false", async () => {
      const input = createInput();
      const draft = await buildNoteDraft(input, { includeClientTag: false });

      const clientTag = draft.tags.find((t) => t[0] === "client");
      expect(clientTag).toBeUndefined();
    });

    it("should not include client tag by default", async () => {
      const input = createInput();
      const draft = await buildNoteDraft(input);

      const clientTag = draft.tags.find((t) => t[0] === "client");
      expect(clientTag).toBeUndefined();
    });
  });

  describe("blob attachments (imeta tags)", () => {
    it("should add imeta tag for blob attachment", async () => {
      const input = createInput({
        blobAttachments: [
          {
            url: "https://cdn.example.com/image.jpg",
            sha256: "abc123hash",
            mimeType: "image/jpeg",
            size: 12345,
          },
        ],
      });
      const draft = await buildNoteDraft(input);

      const imetaTags = draft.tags.filter((t) => t[0] === "imeta");
      expect(imetaTags).toHaveLength(1);
      expect(imetaTags[0]).toContain("imeta");
      expect(imetaTags[0]).toContain("url https://cdn.example.com/image.jpg");
      expect(imetaTags[0]).toContain("m image/jpeg");
      expect(imetaTags[0]).toContain("x abc123hash");
      expect(imetaTags[0]).toContain("size 12345");
    });

    it("should include server in imeta tag when provided", async () => {
      const input = createInput({
        blobAttachments: [
          {
            url: "https://cdn.example.com/image.jpg",
            sha256: "abc123hash",
            mimeType: "image/jpeg",
            size: 12345,
            server: "https://blossom.example.com",
          },
        ],
      });
      const draft = await buildNoteDraft(input);

      const imetaTags = draft.tags.filter((t) => t[0] === "imeta");
      expect(imetaTags[0]).toContain("server https://blossom.example.com");
    });

    it("should not include server in imeta tag when not provided", async () => {
      const input = createInput({
        blobAttachments: [
          {
            url: "https://cdn.example.com/image.jpg",
            sha256: "abc123hash",
            mimeType: "image/jpeg",
            size: 12345,
          },
        ],
      });
      const draft = await buildNoteDraft(input);

      const imetaTags = draft.tags.filter((t) => t[0] === "imeta");
      const hasServer = imetaTags[0]?.some(
        (item) => typeof item === "string" && item.startsWith("server "),
      );
      expect(hasServer).toBe(false);
    });

    it("should add multiple imeta tags for multiple attachments", async () => {
      const input = createInput({
        blobAttachments: [
          {
            url: "https://cdn.example.com/image1.jpg",
            sha256: "hash1",
            mimeType: "image/jpeg",
            size: 1000,
          },
          {
            url: "https://cdn.example.com/video.mp4",
            sha256: "hash2",
            mimeType: "video/mp4",
            size: 50000,
          },
        ],
      });
      const draft = await buildNoteDraft(input);

      const imetaTags = draft.tags.filter((t) => t[0] === "imeta");
      expect(imetaTags).toHaveLength(2);
    });
  });

  describe("complex scenarios", () => {
    it("should handle all features combined", async () => {
      const input = createInput({
        content: "Check out this post #nostr :fire:",
        title: "My Announcement",
        emojiTags: [{ shortcode: "fire", url: "https://example.com/fire.gif" }],
        blobAttachments: [
          {
            url: "https://cdn.example.com/photo.jpg",
            sha256: "photohash",
            mimeType: "image/jpeg",
            size: 5000,
            server: "https://blossom.example.com",
          },
        ],
        addressRefs: [
          {
            kind: 30023,
            pubkey: "authorpub",
            identifier: "referenced-article",
          },
        ],
      });
      const draft = await buildNoteDraft(input, { includeClientTag: true });

      // Verify all components
      expect(draft.kind).toBe(1);
      expect(draft.content).toBe("Check out this post #nostr :fire:");

      // Subject tag
      expect(draft.tags.find((t) => t[0] === "subject")).toEqual([
        "subject",
        "My Announcement",
      ]);

      // Hashtag
      expect(draft.tags.filter((t) => t[0] === "t")).toContainEqual([
        "t",
        "nostr",
      ]);

      // Emoji
      expect(draft.tags.filter((t) => t[0] === "emoji")).toContainEqual([
        "emoji",
        "fire",
        "https://example.com/fire.gif",
      ]);

      // Address reference
      expect(draft.tags.filter((t) => t[0] === "a")).toContainEqual([
        "a",
        "30023:authorpub:referenced-article",
      ]);

      // Client tag
      expect(draft.tags.find((t) => t[0] === "client")).toEqual(
        GRIMOIRE_CLIENT_TAG,
      );

      // Imeta tag
      const imetaTag = draft.tags.find((t) => t[0] === "imeta");
      expect(imetaTag).toBeDefined();
      expect(imetaTag).toContain("url https://cdn.example.com/photo.jpg");
    });

    it("should handle empty content with attachments", async () => {
      const input = createInput({
        content: "",
        blobAttachments: [
          {
            url: "https://cdn.example.com/image.jpg",
            sha256: "hash",
            mimeType: "image/jpeg",
            size: 1000,
          },
        ],
      });
      const draft = await buildNoteDraft(input);

      expect(draft.kind).toBe(1);
      expect(draft.content).toBe("");
      expect(draft.tags.filter((t) => t[0] === "imeta")).toHaveLength(1);
    });
  });
});
