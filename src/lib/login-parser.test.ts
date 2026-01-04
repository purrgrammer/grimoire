import { describe, it, expect, vi } from "vitest";
import {
  detectLoginInputType,
  createAccountFromInput,
  isValidLoginInput,
} from "./login-parser";
import * as nip05 from "./nip05";

// Mock the NIP-05 module
vi.mock("./nip05", () => ({
  resolveNip05: vi.fn(),
  isNip05: vi.fn((value: string) => {
    // Simple mock implementation
    return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}$/.test(value);
  }),
}));

describe("detectLoginInputType", () => {
  it("should detect npub format", () => {
    const npub =
      "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    expect(detectLoginInputType(npub)).toBe("npub");
  });

  it("should detect nprofile format", () => {
    const nprofile =
      "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
    expect(detectLoginInputType(nprofile)).toBe("nprofile");
  });

  it("should detect hex pubkey format", () => {
    const hex =
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    expect(detectLoginInputType(hex)).toBe("hex");
  });

  it("should detect nip-05 format", () => {
    expect(detectLoginInputType("alice@example.com")).toBe("nip05");
    expect(detectLoginInputType("bob@nostr.com")).toBe("nip05");
  });

  it("should detect bunker URL format", () => {
    expect(detectLoginInputType("bunker://pubkey?relay=wss://...")).toBe(
      "bunker",
    );
    expect(detectLoginInputType("nostrconnect://pubkey?relay=wss://...")).toBe(
      "bunker",
    );
  });

  it("should return extension for empty input", () => {
    expect(detectLoginInputType("")).toBe("extension");
    expect(detectLoginInputType("   ")).toBe("extension");
  });

  it("should return unknown for invalid input", () => {
    expect(detectLoginInputType("invalid")).toBe("unknown");
    expect(detectLoginInputType("random text")).toBe("unknown");
  });

  it("should handle whitespace correctly", () => {
    const npub =
      "  npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6  ";
    expect(detectLoginInputType(npub)).toBe("npub");
  });

  it("should detect hex with uppercase", () => {
    const hex =
      "3BF0C63FCB93463407AF97A5E5EE64FA883D107EF9E558472C4EB9AAAEFA459D";
    expect(detectLoginInputType(hex)).toBe("hex");
  });

  it("should reject too short hex", () => {
    expect(detectLoginInputType("3bf0c63f")).toBe("unknown");
  });

  it("should reject too long hex", () => {
    const longHex =
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d00";
    expect(detectLoginInputType(longHex)).toBe("unknown");
  });
});

describe("createAccountFromInput", () => {
  it("should create account from npub", async () => {
    const npub =
      "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    const account = await createAccountFromInput(npub);

    expect(account.pubkey).toBe(
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    );
    expect(account.metadata?.source).toBe("npub");
  });

  it("should create account from hex", async () => {
    const hex =
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    const account = await createAccountFromInput(hex);

    expect(account.pubkey).toBe(hex);
    expect(account.metadata?.source).toBe("hex");
  });

  it("should create account from nprofile", async () => {
    const nprofile =
      "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
    const account = await createAccountFromInput(nprofile);

    expect(account.pubkey).toBe(
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    );
    expect(account.metadata?.source).toBe("nprofile");
    expect(account.metadata?.relays).toBeDefined();
  });

  it("should create account from nip-05", async () => {
    const nip05Id = "alice@example.com";
    const pubkey =
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

    vi.mocked(nip05.resolveNip05).mockResolvedValue(pubkey);

    const account = await createAccountFromInput(nip05Id);

    expect(account.pubkey).toBe(pubkey);
    expect(account.metadata?.source).toBe("nip05");
    expect(account.metadata?.nip05).toBe(nip05Id);
  });

  it("should throw error for bunker URL (not yet implemented)", async () => {
    const bunker = "bunker://pubkey?relay=wss://relay.example.com";

    await expect(createAccountFromInput(bunker)).rejects.toThrow(
      "Remote signer (NIP-46) support coming soon",
    );
  });

  it("should throw error for extension (requires UI)", async () => {
    await expect(createAccountFromInput("")).rejects.toThrow(
      "Extension login requires UI interaction",
    );
  });

  it("should throw error for unknown format", async () => {
    await expect(createAccountFromInput("invalid")).rejects.toThrow(
      "Unknown input format",
    );
  });

  it("should handle whitespace in input", async () => {
    const hex =
      "  3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d  ";
    const account = await createAccountFromInput(hex);

    expect(account.pubkey).toBe(hex.trim().toLowerCase());
  });

  it("should throw descriptive error for invalid npub", async () => {
    await expect(createAccountFromInput("npub1invalid")).rejects.toThrow(
      "Failed to decode npub",
    );
  });

  it("should throw descriptive error for failed nip-05 resolution", async () => {
    vi.mocked(nip05.resolveNip05).mockResolvedValue(null);

    await expect(
      createAccountFromInput("notfound@example.com"),
    ).rejects.toThrow("Failed to resolve NIP-05 identifier");
  });
});

describe("isValidLoginInput", () => {
  it("should return true for valid npub", () => {
    const npub =
      "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    expect(isValidLoginInput(npub)).toBe(true);
  });

  it("should return true for valid hex", () => {
    const hex =
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    expect(isValidLoginInput(hex)).toBe(true);
  });

  it("should return true for valid nip-05", () => {
    expect(isValidLoginInput("alice@example.com")).toBe(true);
  });

  it("should return true for valid nprofile", () => {
    const nprofile =
      "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
    expect(isValidLoginInput(nprofile)).toBe(true);
  });

  it("should return true for bunker URL", () => {
    expect(isValidLoginInput("bunker://pubkey?relay=wss://...")).toBe(true);
  });

  it("should return false for empty input", () => {
    expect(isValidLoginInput("")).toBe(false);
    expect(isValidLoginInput("   ")).toBe(false);
  });

  it("should return false for unknown format", () => {
    expect(isValidLoginInput("invalid")).toBe(false);
  });

  it("should return false for extension (requires UI)", () => {
    // Empty string triggers extension type
    expect(isValidLoginInput("")).toBe(false);
  });
});
