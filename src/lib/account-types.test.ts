import { describe, it, expect, vi } from "vitest";
import { ReadOnlyAccount } from "./account-types";
import * as nip05 from "./nip05";

// Mock the NIP-05 resolver
vi.mock("./nip05", () => ({
  resolveNip05: vi.fn(),
}));

describe("ReadOnlyAccount", () => {
  describe("fromHex", () => {
    it("should create account from valid hex pubkey", () => {
      const hex =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const account = ReadOnlyAccount.fromHex(hex);

      expect(account.pubkey).toBe(hex);
      expect(account.id).toBe(`readonly:${hex}`);
      expect(account.metadata.type).toBe("readonly");
      expect(account.metadata.source).toBe("hex");
      expect(account.metadata.originalInput).toBe(hex);
      expect(account.signer).toBeUndefined();
    });

    it("should normalize hex to lowercase", () => {
      const hex =
        "3BF0C63FCB93463407AF97A5E5EE64FA883D107EF9E558472C4EB9AAAEFA459D";
      const account = ReadOnlyAccount.fromHex(hex);

      expect(account.pubkey).toBe(hex.toLowerCase());
    });

    it("should reject invalid hex length", () => {
      expect(() => ReadOnlyAccount.fromHex("abc123")).toThrow(
        "Invalid hex pubkey",
      );
    });

    it("should reject non-hex characters", () => {
      const invalidHex =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa45zz";
      expect(() => ReadOnlyAccount.fromHex(invalidHex)).toThrow(
        "Invalid hex pubkey",
      );
    });
  });

  describe("fromNpub", () => {
    it("should create account from valid npub", async () => {
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const account = await ReadOnlyAccount.fromNpub(npub);

      expect(account.pubkey).toBe(
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      );
      expect(account.metadata.source).toBe("npub");
      expect(account.metadata.originalInput).toBe(npub);
    });

    it("should reject invalid npub format", async () => {
      await expect(ReadOnlyAccount.fromNpub("invalid")).rejects.toThrow(
        "Failed to decode npub",
      );
    });

    it("should reject non-npub nip19 formats", async () => {
      const nsec =
        "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
      await expect(ReadOnlyAccount.fromNpub(nsec)).rejects.toThrow(
        "Invalid npub: expected npub format",
      );
    });
  });

  describe("fromNprofile", () => {
    it("should create account from valid nprofile", async () => {
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const account = await ReadOnlyAccount.fromNprofile(nprofile);

      expect(account.pubkey).toBe(
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      );
      expect(account.metadata.source).toBe("nprofile");
      expect(account.metadata.relays).toBeDefined();
      expect(account.metadata.relays?.length).toBeGreaterThan(0);
    });

    it("should reject invalid nprofile format", async () => {
      await expect(ReadOnlyAccount.fromNprofile("invalid")).rejects.toThrow(
        "Failed to decode nprofile",
      );
    });

    it("should reject non-nprofile nip19 formats", async () => {
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      await expect(ReadOnlyAccount.fromNprofile(npub)).rejects.toThrow(
        "Invalid nprofile: expected nprofile format",
      );
    });
  });

  describe("fromNip05", () => {
    it("should create account from valid nip-05", async () => {
      const nip05Id = "alice@example.com";
      const pubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

      vi.mocked(nip05.resolveNip05).mockResolvedValue(pubkey);

      const account = await ReadOnlyAccount.fromNip05(nip05Id);

      expect(account.pubkey).toBe(pubkey);
      expect(account.metadata.source).toBe("nip05");
      expect(account.metadata.nip05).toBe(nip05Id);
      expect(account.metadata.originalInput).toBe(nip05Id);
      expect(nip05.resolveNip05).toHaveBeenCalledWith(nip05Id);
    });

    it("should reject when nip-05 resolution fails", async () => {
      vi.mocked(nip05.resolveNip05).mockResolvedValue(null);

      await expect(ReadOnlyAccount.fromNip05("invalid@example.com")).rejects.toThrow(
        "Failed to resolve NIP-05 identifier",
      );
    });
  });

  describe("toJSON and fromJSON", () => {
    it("should serialize and deserialize correctly", () => {
      const hex =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const account = ReadOnlyAccount.fromHex(hex);

      const json = account.toJSON();
      const restored = ReadOnlyAccount.fromJSON(json);

      expect(restored.pubkey).toBe(account.pubkey);
      expect(restored.id).toBe(account.id);
      expect(restored.metadata.type).toBe(account.metadata.type);
      expect(restored.metadata.source).toBe(account.metadata.source);
      expect(restored.metadata.originalInput).toBe(
        account.metadata.originalInput,
      );
    });

    it("should preserve nprofile relays through serialization", async () => {
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const account = await ReadOnlyAccount.fromNprofile(nprofile);

      const json = account.toJSON();
      const restored = ReadOnlyAccount.fromJSON(json);

      expect(restored.metadata.relays).toEqual(account.metadata.relays);
    });

    it("should preserve nip05 identifier through serialization", async () => {
      const nip05Id = "alice@example.com";
      const pubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

      vi.mocked(nip05.resolveNip05).mockResolvedValue(pubkey);

      const account = await ReadOnlyAccount.fromNip05(nip05Id);

      const json = account.toJSON();
      const restored = ReadOnlyAccount.fromJSON(json);

      expect(restored.metadata.nip05).toBe(nip05Id);
    });
  });

  describe("account properties", () => {
    it("should have no signer for read-only accounts", () => {
      const hex =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const account = ReadOnlyAccount.fromHex(hex);

      expect(account.signer).toBeUndefined();
    });

    it("should have consistent ID format", () => {
      const hex =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const account = ReadOnlyAccount.fromHex(hex);

      expect(account.id).toBe(`readonly:${hex}`);
      expect(account.id).toContain("readonly:");
    });

    it("should have readonly type in metadata", () => {
      const hex =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const account = ReadOnlyAccount.fromHex(hex);

      expect(account.metadata.type).toBe("readonly");
    });
  });
});
