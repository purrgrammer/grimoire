/**
 * Tests for NIP-59 Gift Wrap Service
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { unwrapAndUnseal, GiftWrapError } from "./gift-wrap";
import type { NostrEvent } from "@/types/nostr";
import type { ISigner } from "applesauce-signers";

// Mock applesauce functions
vi.mock("applesauce-common/helpers", () => ({
  unlockGiftWrap: vi.fn(),
  getGiftWrapSeal: vi.fn(),
}));

import { unlockGiftWrap, getGiftWrapSeal } from "applesauce-common/helpers";

// Get mocked functions
const mockUnlockGiftWrap = vi.mocked(unlockGiftWrap);
const mockGetGiftWrapSeal = vi.mocked(getGiftWrapSeal);

// Mock signer for testing
function createMockSigner(decryptResponses: Map<string, string>): ISigner {
  return {
    getPublicKey: vi.fn().mockResolvedValue("mock-pubkey"),
    signEvent: vi.fn(),
    nip44: {
      encrypt: vi.fn(),
      decrypt: vi.fn(async (pubkey: string, ciphertext: string) => {
        const response = decryptResponses.get(`${pubkey}:${ciphertext}`);
        if (!response) {
          throw new Error("Mock decryption failed: no response configured");
        }
        return response;
      }),
    },
  };
}

describe("GiftWrapError", () => {
  it("should create error with code", () => {
    const error = new GiftWrapError("Test error", "INVALID_KIND");
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("INVALID_KIND");
    expect(error.name).toBe("GiftWrapError");
  });
});

describe("unwrapAndUnseal", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  describe("validation", () => {
    it("should reject signer without NIP-44 support", async () => {
      const giftWrap: NostrEvent = {
        id: "test-id",
        pubkey: "ephemeral-key",
        created_at: 1234567890,
        kind: 1059,
        tags: [],
        content: "encrypted-content",
        sig: "signature",
      };

      // Signer without nip44
      const signerWithoutNip44: ISigner = {
        getPublicKey: vi.fn().mockResolvedValue("mock-pubkey"),
        signEvent: vi.fn(),
      };

      await expect(
        unwrapAndUnseal(giftWrap, signerWithoutNip44),
      ).rejects.toThrow(GiftWrapError);

      await expect(
        unwrapAndUnseal(giftWrap, signerWithoutNip44),
      ).rejects.toThrow("does not support NIP-44");
    });

    it("should reject non-1059 events", async () => {
      const invalidGiftWrap: NostrEvent = {
        id: "test-id",
        pubkey: "ephemeral-key",
        created_at: 1234567890,
        kind: 1, // Wrong kind
        tags: [],
        content: "encrypted-content",
        sig: "signature",
      };

      const signer = createMockSigner(new Map());

      await expect(unwrapAndUnseal(invalidGiftWrap, signer)).rejects.toThrow(
        GiftWrapError,
      );

      await expect(unwrapAndUnseal(invalidGiftWrap, signer)).rejects.toThrow(
        "Expected kind 1059",
      );
    });

    it("should reject gift wrap with empty content", async () => {
      const emptyGiftWrap: NostrEvent = {
        id: "test-id",
        pubkey: "ephemeral-key",
        created_at: 1234567890,
        kind: 1059,
        tags: [],
        content: "", // Empty
        sig: "signature",
      };

      const signer = createMockSigner(new Map());

      await expect(unwrapAndUnseal(emptyGiftWrap, signer)).rejects.toThrow(
        GiftWrapError,
      );

      await expect(unwrapAndUnseal(emptyGiftWrap, signer)).rejects.toThrow(
        "content is empty",
      );
    });
  });

  describe("unwrapping", () => {
    it("should unwrap valid gift wrap to get seal", async () => {
      const seal: NostrEvent = {
        id: "seal-id",
        pubkey: "sender-real-key",
        created_at: 1234567890,
        kind: 13,
        tags: [],
        content: "encrypted-rumor",
        sig: "seal-signature",
      };

      const rumor = {
        id: "rumor-id-1234567890",
        kind: 1,
        content: "Hello, world!",
        tags: [],
        created_at: 1234567890,
        pubkey: "sender-real-key",
      };

      const giftWrap: NostrEvent = {
        id: "gift-wrap-id",
        pubkey: "ephemeral-key",
        created_at: 1234567899, // Tweaked timestamp
        kind: 1059,
        tags: [["p", "recipient-pubkey"]],
        content: "encrypted-seal",
        sig: "gift-wrap-signature",
      };

      // Mock applesauce to return our test data
      mockUnlockGiftWrap.mockResolvedValue(rumor as any);
      mockGetGiftWrapSeal.mockReturnValue(seal);

      const signer = createMockSigner(new Map());

      const result = await unwrapAndUnseal(giftWrap, signer);

      expect(result.seal).toEqual(seal);
      expect(result.rumor.kind).toBe(1);
      expect(result.rumor.content).toBe("Hello, world!");
      expect(result.rumor.pubkey).toBe("sender-real-key");
    });

    it("should attach sender pubkey to rumor", async () => {
      const seal: NostrEvent = {
        id: "seal-id",
        pubkey: "sender-real-key",
        created_at: 1234567890,
        kind: 13,
        tags: [],
        content: "encrypted-rumor",
        sig: "seal-signature",
      };

      // Rumor without pubkey (as it should be when extracted)
      const rumor = {
        id: "rumor-id-test-message",
        kind: 1,
        content: "Test message",
        tags: [],
        created_at: 1234567890,
        pubkey: "sender-real-key",
      };

      const giftWrap: NostrEvent = {
        id: "gift-wrap-id",
        pubkey: "ephemeral-key",
        created_at: 1234567899,
        kind: 1059,
        tags: [["p", "recipient-pubkey"]],
        content: "encrypted-seal",
        sig: "gift-wrap-signature",
      };

      // Mock applesauce to return our test data
      mockUnlockGiftWrap.mockResolvedValue(rumor as any);
      mockGetGiftWrapSeal.mockReturnValue(seal);

      const signer = createMockSigner(new Map());

      const result = await unwrapAndUnseal(giftWrap, signer);

      // Pubkey should be attached from seal
      expect(result.rumor.pubkey).toBe("sender-real-key");
    });

    it("should reject invalid seal kind", async () => {
      const invalidSeal = {
        id: "seal-id",
        pubkey: "sender-real-key",
        created_at: 1234567890,
        kind: 1, // Wrong kind
        tags: [],
        content: "encrypted-rumor",
        sig: "seal-signature",
      };

      const rumor = {
        id: "rumor-id",
        kind: 1,
        content: "Test",
        tags: [],
        created_at: 1234567890,
        pubkey: "sender-real-key",
      };

      const giftWrap: NostrEvent = {
        id: "gift-wrap-id",
        pubkey: "ephemeral-key",
        created_at: 1234567899,
        kind: 1059,
        tags: [["p", "recipient-pubkey"]],
        content: "encrypted-seal",
        sig: "gift-wrap-signature",
      };

      // Mock applesauce to return invalid seal
      mockUnlockGiftWrap.mockResolvedValue(rumor as any);
      mockGetGiftWrapSeal.mockReturnValue(invalidSeal as NostrEvent);

      const signer = createMockSigner(new Map());

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        GiftWrapError,
      );

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        "Expected seal kind 13",
      );
    });

    it("should reject seal with empty content", async () => {
      const invalidSeal: NostrEvent = {
        id: "seal-id",
        pubkey: "sender-real-key",
        created_at: 1234567890,
        kind: 13,
        tags: [],
        content: "", // Empty
        sig: "seal-signature",
      };

      const rumor = {
        id: "rumor-id",
        kind: 1,
        content: "Test",
        tags: [],
        created_at: 1234567890,
        pubkey: "sender-real-key",
      };

      const giftWrap: NostrEvent = {
        id: "gift-wrap-id",
        pubkey: "ephemeral-key",
        created_at: 1234567899,
        kind: 1059,
        tags: [["p", "recipient-pubkey"]],
        content: "encrypted-seal",
        sig: "gift-wrap-signature",
      };

      // Mock applesauce to return seal with empty content
      mockUnlockGiftWrap.mockResolvedValue(rumor as any);
      mockGetGiftWrapSeal.mockReturnValue(invalidSeal);

      const signer = createMockSigner(new Map());

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        GiftWrapError,
      );

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        "Seal content is empty",
      );
    });

    it("should reject invalid rumor structure", async () => {
      const seal: NostrEvent = {
        id: "seal-id",
        pubkey: "sender-real-key",
        created_at: 1234567890,
        kind: 13,
        tags: [],
        content: "encrypted-rumor",
        sig: "seal-signature",
      };

      const invalidRumor = {
        id: "invalid-rumor-id",
        kind: 1,
        // Missing content
        tags: [],
        created_at: 1234567890,
        pubkey: "sender-real-key",
      };

      const giftWrap: NostrEvent = {
        id: "gift-wrap-id",
        pubkey: "ephemeral-key",
        created_at: 1234567899,
        kind: 1059,
        tags: [["p", "recipient-pubkey"]],
        content: "encrypted-seal",
        sig: "gift-wrap-signature",
      };

      // Mock applesauce to return invalid rumor (missing content)
      mockUnlockGiftWrap.mockResolvedValue(invalidRumor as any);
      mockGetGiftWrapSeal.mockReturnValue(seal);

      const signer = createMockSigner(new Map());

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        GiftWrapError,
      );

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        "Rumor missing content",
      );
    });

    it("should handle decryption failures", async () => {
      const giftWrap: NostrEvent = {
        id: "gift-wrap-id",
        pubkey: "ephemeral-key",
        created_at: 1234567899,
        kind: 1059,
        tags: [["p", "recipient-pubkey"]],
        content: "encrypted-seal",
        sig: "gift-wrap-signature",
      };

      // Mock applesauce to throw decryption error
      mockUnlockGiftWrap.mockRejectedValue(
        new Error("Mock decryption failed: unable to decrypt"),
      );

      const signer = createMockSigner(new Map());

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        GiftWrapError,
      );

      await expect(unwrapAndUnseal(giftWrap, signer)).rejects.toThrow(
        "Failed to decrypt",
      );
    });
  });
});
