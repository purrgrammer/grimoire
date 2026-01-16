import { describe, it, expect } from "vitest";
import {
  buildKind1Event,
  buildKind11Event,
  type PostMetadata,
} from "./event-builders";
import type { NostrEvent } from "nostr-tools";
import { kinds } from "nostr-tools";

const TEST_PUBKEY =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const PARENT_PUBKEY =
  "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const ROOT_PUBKEY = "91cf9..4341";

describe("buildKind1Event", () => {
  describe("basic note creation", () => {
    it("should create a simple kind 1 note", () => {
      const post: PostMetadata = {
        content: "Hello Nostr!",
      };

      const event = buildKind1Event({
        post,
        pubkey: TEST_PUBKEY,
      });

      expect(event.kind).toBe(kinds.ShortTextNote);
      expect(event.content).toBe("Hello Nostr!");
      expect(event.pubkey).toBe(TEST_PUBKEY);
      expect(event.tags).toEqual([]);
      expect(event.created_at).toBeGreaterThan(0);
    });

    it("should include emoji tags", () => {
      const post: PostMetadata = {
        content: "Hello :custom_emoji:",
        emojiTags: [
          { shortcode: "custom_emoji", url: "https://example.com/emoji.png" },
        ],
      };

      const event = buildKind1Event({
        post,
        pubkey: TEST_PUBKEY,
      });

      expect(event.tags).toContainEqual([
        "emoji",
        "custom_emoji",
        "https://example.com/emoji.png",
      ]);
    });

    it("should include blob attachments as imeta tags", () => {
      const post: PostMetadata = {
        content: "Check out this image: https://example.com/image.jpg",
        blobAttachments: [
          {
            url: "https://example.com/image.jpg",
            sha256: "abc123",
            mimeType: "image/jpeg",
            size: 12345,
            server: "https://blossom.example.com",
          },
        ],
      };

      const event = buildKind1Event({
        post,
        pubkey: TEST_PUBKEY,
      });

      expect(event.tags).toContainEqual([
        "imeta",
        "url https://example.com/image.jpg",
        "m image/jpeg",
        "x abc123",
        "size 12345",
        "ox https://blossom.example.com",
      ]);
    });

    it("should include mentioned pubkeys as p-tags", () => {
      const post: PostMetadata = {
        content: "Hello nostr:npub1...",
        mentionedPubkeys: [PARENT_PUBKEY],
      };

      const event = buildKind1Event({
        post,
        pubkey: TEST_PUBKEY,
      });

      expect(event.tags).toContainEqual(["p", PARENT_PUBKEY]);
    });

    it("should include hashtags as t-tags (lowercase)", () => {
      const post: PostMetadata = {
        content: "Hello #Nostr #Bitcoin",
        hashtags: ["Nostr", "Bitcoin"],
      };

      const event = buildKind1Event({
        post,
        pubkey: TEST_PUBKEY,
      });

      expect(event.tags).toContainEqual(["t", "nostr"]);
      expect(event.tags).toContainEqual(["t", "bitcoin"]);
    });
  });

  describe("NIP-10 reply threading", () => {
    it("should create reply tags when replying to root event", () => {
      const parentEvent: NostrEvent = {
        id: "parent123",
        pubkey: PARENT_PUBKEY,
        created_at: 1234567890,
        kind: kinds.ShortTextNote,
        tags: [],
        content: "Original post",
        sig: "sig123",
      };

      const post: PostMetadata = {
        content: "Great post!",
      };

      const event = buildKind1Event({
        post,
        replyTo: parentEvent,
        pubkey: TEST_PUBKEY,
      });

      // Should have root and reply e-tags
      expect(event.tags).toContainEqual(["e", "parent123", "", "root"]);
      expect(event.tags).toContainEqual(["e", "parent123", "", "reply"]);

      // Should have p-tag for parent author
      expect(event.tags).toContainEqual(["p", PARENT_PUBKEY]);
    });

    it("should preserve root when replying to a reply", () => {
      const parentEvent: NostrEvent = {
        id: "parent123",
        pubkey: PARENT_PUBKEY,
        created_at: 1234567891,
        kind: kinds.ShortTextNote,
        tags: [
          ["e", "root123", "", "root"],
          ["e", "root123", "", "reply"],
          ["p", ROOT_PUBKEY],
        ],
        content: "Reply to root",
        sig: "sig456",
      };

      const post: PostMetadata = {
        content: "Reply to reply",
      };

      const event = buildKind1Event({
        post,
        replyTo: parentEvent,
        pubkey: TEST_PUBKEY,
      });

      // Should preserve original root
      expect(event.tags).toContainEqual(["e", "root123", "", "root"]);

      // Should reply to immediate parent
      expect(event.tags).toContainEqual(["e", "parent123", "", "reply"]);

      // Should have p-tag for parent author
      expect(event.tags).toContainEqual(["p", PARENT_PUBKEY]);
    });

    it("should deduplicate p-tags when mentioned pubkey is also parent author", () => {
      const parentEvent: NostrEvent = {
        id: "parent123",
        pubkey: PARENT_PUBKEY,
        created_at: 1234567890,
        kind: kinds.ShortTextNote,
        tags: [],
        content: "Original post",
        sig: "sig123",
      };

      const post: PostMetadata = {
        content: "Reply mentioning parent nostr:npub1...",
        mentionedPubkeys: [PARENT_PUBKEY], // Same as parent author
      };

      const event = buildKind1Event({
        post,
        replyTo: parentEvent,
        pubkey: TEST_PUBKEY,
      });

      // Should only have one p-tag for parent author
      const pTags = event.tags.filter((t) => t[0] === "p");
      expect(pTags.length).toBe(1);
      expect(pTags[0]).toEqual(["p", PARENT_PUBKEY]);
    });

    it("should include relay hints from parent event", () => {
      const parentEvent: NostrEvent = {
        id: "parent123",
        pubkey: PARENT_PUBKEY,
        created_at: 1234567890,
        kind: kinds.ShortTextNote,
        tags: [["e", "parent123", "wss://relay.example.com"]],
        content: "Original post",
        sig: "sig123",
      };

      const post: PostMetadata = {
        content: "Great post!",
      };

      const event = buildKind1Event({
        post,
        replyTo: parentEvent,
        pubkey: TEST_PUBKEY,
      });

      // Should use relay hint from parent
      expect(event.tags).toContainEqual([
        "e",
        "parent123",
        "wss://relay.example.com",
        "root",
      ]);
      expect(event.tags).toContainEqual([
        "e",
        "parent123",
        "wss://relay.example.com",
        "reply",
      ]);
    });
  });
});

describe("buildKind11Event", () => {
  it("should create a thread with title tag", () => {
    const post: PostMetadata = {
      content: "This is the thread content",
    };

    const event = buildKind11Event({
      title: "My Thread Title",
      post,
      pubkey: TEST_PUBKEY,
    });

    expect(event.kind).toBe(11);
    expect(event.content).toBe("This is the thread content");
    expect(event.pubkey).toBe(TEST_PUBKEY);
    expect(event.tags).toContainEqual(["title", "My Thread Title"]);
    expect(event.created_at).toBeGreaterThan(0);
  });

  it("should include emoji tags", () => {
    const post: PostMetadata = {
      content: "Thread with :emoji:",
      emojiTags: [{ shortcode: "emoji", url: "https://example.com/emoji.png" }],
    };

    const event = buildKind11Event({
      title: "Emoji Thread",
      post,
      pubkey: TEST_PUBKEY,
    });

    expect(event.tags).toContainEqual(["title", "Emoji Thread"]);
    expect(event.tags).toContainEqual([
      "emoji",
      "emoji",
      "https://example.com/emoji.png",
    ]);
  });

  it("should include blob attachments", () => {
    const post: PostMetadata = {
      content: "Thread with image",
      blobAttachments: [
        {
          url: "https://example.com/image.jpg",
          sha256: "abc123",
          mimeType: "image/jpeg",
          size: 12345,
        },
      ],
    };

    const event = buildKind11Event({
      title: "Image Thread",
      post,
      pubkey: TEST_PUBKEY,
    });

    expect(event.tags).toContainEqual(["title", "Image Thread"]);
    expect(event.tags).toContainEqual([
      "imeta",
      "url https://example.com/image.jpg",
      "m image/jpeg",
      "x abc123",
      "size 12345",
    ]);
  });

  it("should include mentioned pubkeys and hashtags", () => {
    const post: PostMetadata = {
      content: "Thread mentioning nostr:npub1... #nostr",
      mentionedPubkeys: [PARENT_PUBKEY],
      hashtags: ["nostr"],
    };

    const event = buildKind11Event({
      title: "Mentions Thread",
      post,
      pubkey: TEST_PUBKEY,
    });

    expect(event.tags).toContainEqual(["title", "Mentions Thread"]);
    expect(event.tags).toContainEqual(["p", PARENT_PUBKEY]);
    expect(event.tags).toContainEqual(["t", "nostr"]);
  });

  it("should handle minimal blob metadata", () => {
    const post: PostMetadata = {
      content: "Thread with minimal blob",
      blobAttachments: [
        {
          url: "https://example.com/file.bin",
          sha256: "xyz789",
          // No mimeType, size, or server
        },
      ],
    };

    const event = buildKind11Event({
      title: "Minimal Blob",
      post,
      pubkey: TEST_PUBKEY,
    });

    expect(event.tags).toContainEqual([
      "imeta",
      "url https://example.com/file.bin",
      "x xyz789",
    ]);
  });
});
