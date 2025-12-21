import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveSpellbook,
  getSpellbook,
  deleteSpellbook,
  markSpellbookPublished,
  getAllSpellbooks,
} from "./spellbook-storage";
import db from "./db";
import type { SpellbookContent } from "@/types/spell";

describe("Spellbook Storage", () => {
  // Clean up database before each test
  beforeEach(async () => {
    await db.spellbooks.clear();
  });

  afterEach(async () => {
    await db.spellbooks.clear();
  });

  const mockContent: SpellbookContent = {
    version: 1,
    workspaces: {
      "ws-1": {
        id: "ws-1",
        number: 1,
        label: "Main",
        layout: "win-1",
        windowIds: ["win-1"],
      },
    },
    windows: {
      "win-1": {
        id: "win-1",
        appId: "req",
        props: { filter: { kinds: [1] } },
        commandString: "req -k 1",
      },
    },
  };

  describe("saveSpellbook", () => {
    it("should save a new spellbook with generated ID", async () => {
      const saved = await saveSpellbook({
        slug: "test-spellbook",
        title: "Test Spellbook",
        description: "Test description",
        content: mockContent,
        isPublished: false,
      });

      expect(saved.id).toBeDefined();
      expect(saved.slug).toBe("test-spellbook");
      expect(saved.title).toBe("Test Spellbook");
      expect(saved.createdAt).toBeDefined();
      expect(saved.isPublished).toBe(false);
    });

    it("should update existing spellbook when saving with same slug (local-only)", async () => {
      // Save initial version
      const first = await saveSpellbook({
        slug: "my-layout",
        title: "My Layout",
        content: mockContent,
        isPublished: false,
      });

      // Save again with same slug (should update, not create new)
      const second = await saveSpellbook({
        slug: "my-layout",
        title: "My Updated Layout",
        content: mockContent,
        isPublished: false,
      });

      // Should have same ID
      expect(second.id).toBe(first.id);
      expect(second.title).toBe("My Updated Layout");

      // Should only have one spellbook in DB
      const all = await getAllSpellbooks();
      expect(all.length).toBe(1);
      expect(all[0].title).toBe("My Updated Layout");
    });

    it("should update existing spellbook when saving with same slug and pubkey", async () => {
      const mockEvent = {
        id: "event-1",
        pubkey: "test-pubkey",
        created_at: Math.floor(Date.now() / 1000),
        kind: 30777,
        tags: [["d", "shared-layout"]],
        content: JSON.stringify(mockContent),
        sig: "test-sig",
      } as any;

      // Save initial version
      const first = await saveSpellbook({
        slug: "shared-layout",
        title: "Shared Layout",
        content: mockContent,
        isPublished: true,
        eventId: "event-1",
        event: mockEvent,
      });

      // Save again with same slug and pubkey
      const second = await saveSpellbook({
        slug: "shared-layout",
        title: "Updated Shared Layout",
        content: mockContent,
        isPublished: true,
        eventId: "event-1",
        event: mockEvent,
      });

      // Should have same ID (deduplicated)
      expect(second.id).toBe(first.id);
      expect(second.title).toBe("Updated Shared Layout");

      // Should only have one spellbook in DB
      const all = await getAllSpellbooks();
      expect(all.length).toBe(1);
    });

    it("should create separate spellbooks for different pubkeys with same slug", async () => {
      const event1 = {
        id: "event-1",
        pubkey: "pubkey-1",
        created_at: Math.floor(Date.now() / 1000),
        kind: 30777,
        tags: [["d", "layout"]],
        content: JSON.stringify(mockContent),
        sig: "sig-1",
      } as any;

      const event2 = {
        id: "event-2",
        pubkey: "pubkey-2",
        created_at: Math.floor(Date.now() / 1000),
        kind: 30777,
        tags: [["d", "layout"]],
        content: JSON.stringify(mockContent),
        sig: "sig-2",
      } as any;

      const first = await saveSpellbook({
        slug: "layout",
        title: "Layout by User 1",
        content: mockContent,
        isPublished: true,
        eventId: "event-1",
        event: event1,
      });

      const second = await saveSpellbook({
        slug: "layout",
        title: "Layout by User 2",
        content: mockContent,
        isPublished: true,
        eventId: "event-2",
        event: event2,
      });

      // Should have different IDs
      expect(first.id).not.toBe(second.id);

      // Should have two spellbooks
      const all = await getAllSpellbooks();
      expect(all.length).toBe(2);
    });

    it("should use provided ID when specified", async () => {
      const customId = "custom-id-123";

      const saved = await saveSpellbook({
        id: customId,
        slug: "custom",
        title: "Custom ID",
        content: mockContent,
        isPublished: false,
      });

      expect(saved.id).toBe(customId);
    });
  });

  describe("getSpellbook", () => {
    it("should retrieve spellbook by ID", async () => {
      const saved = await saveSpellbook({
        slug: "test",
        title: "Test",
        content: mockContent,
        isPublished: false,
      });

      const retrieved = await getSpellbook(saved.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(saved.id);
      expect(retrieved?.title).toBe("Test");
    });

    it("should return undefined for non-existent ID", async () => {
      const retrieved = await getSpellbook("non-existent");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("deleteSpellbook", () => {
    it("should soft-delete a spellbook", async () => {
      const saved = await saveSpellbook({
        slug: "to-delete",
        title: "To Delete",
        content: mockContent,
        isPublished: false,
      });

      await deleteSpellbook(saved.id);

      const retrieved = await getSpellbook(saved.id);
      expect(retrieved?.deletedAt).toBeDefined();
    });
  });

  describe("markSpellbookPublished", () => {
    it("should mark spellbook as published with event", async () => {
      const saved = await saveSpellbook({
        slug: "to-publish",
        title: "To Publish",
        content: mockContent,
        isPublished: false,
      });

      const mockEvent = {
        id: "published-event-id",
        pubkey: "test-pubkey",
        created_at: Math.floor(Date.now() / 1000),
        kind: 30777,
        tags: [["d", "to-publish"]],
        content: JSON.stringify(mockContent),
        sig: "test-sig",
      } as any;

      await markSpellbookPublished(saved.id, mockEvent);

      const updated = await getSpellbook(saved.id);
      expect(updated?.isPublished).toBe(true);
      expect(updated?.eventId).toBe("published-event-id");
      expect(updated?.event).toEqual(mockEvent);
    });
  });

  describe("getAllSpellbooks", () => {
    it("should return all spellbooks sorted by createdAt", async () => {
      // Create spellbooks with different timestamps
      const first = await saveSpellbook({
        slug: "first",
        title: "First",
        content: mockContent,
        isPublished: false,
      });

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await saveSpellbook({
        slug: "second",
        title: "Second",
        content: mockContent,
        isPublished: false,
      });

      const all = await getAllSpellbooks();
      expect(all.length).toBe(2);
      // Should be in reverse chronological order (newest first)
      expect(all[0].id).toBe(second.id);
      expect(all[1].id).toBe(first.id);
    });
  });
});
