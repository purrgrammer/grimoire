import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseBlossomCommand } from "./blossom-parser";

// Mock NIP-05 resolution
vi.mock("./nip05", () => ({
  isNip05: (input: string) =>
    input.includes("@") || /^[a-z0-9-]+\.[a-z]{2,}$/i.test(input),
  resolveNip05: vi.fn(),
}));

import { resolveNip05 } from "./nip05";
const mockResolveNip05 = vi.mocked(resolveNip05);

describe("parseBlossomCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("servers subcommand", () => {
    it("should default to servers when no args provided", async () => {
      const result = await parseBlossomCommand([]);
      expect(result.subcommand).toBe("servers");
    });

    it("should parse explicit servers subcommand", async () => {
      const result = await parseBlossomCommand(["servers"]);
      expect(result.subcommand).toBe("servers");
    });
  });

  describe("server subcommand", () => {
    it("should parse server with URL", async () => {
      const result = await parseBlossomCommand([
        "server",
        "https://blossom.primal.net",
      ]);
      expect(result.subcommand).toBe("server");
      expect(result.serverUrl).toBe("https://blossom.primal.net");
    });

    it("should normalize server URL without protocol", async () => {
      const result = await parseBlossomCommand([
        "server",
        "blossom.primal.net",
      ]);
      expect(result.serverUrl).toBe("https://blossom.primal.net");
    });

    it("should preserve http:// protocol", async () => {
      const result = await parseBlossomCommand([
        "server",
        "http://localhost:3000",
      ]);
      expect(result.serverUrl).toBe("http://localhost:3000");
    });

    it("should throw error when URL missing", async () => {
      await expect(parseBlossomCommand(["server"])).rejects.toThrow(
        "Server URL required",
      );
    });
  });

  describe("upload subcommand", () => {
    it("should parse upload subcommand", async () => {
      const result = await parseBlossomCommand(["upload"]);
      expect(result.subcommand).toBe("upload");
    });
  });

  describe("list subcommand", () => {
    const testPubkey =
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

    it("should parse list with no args (uses active account)", async () => {
      const result = await parseBlossomCommand(["list"], testPubkey);
      expect(result.subcommand).toBe("list");
      expect(result.pubkey).toBe(testPubkey);
    });

    it("should parse list alias 'ls'", async () => {
      const result = await parseBlossomCommand(["ls"], testPubkey);
      expect(result.subcommand).toBe("list");
    });

    it("should parse list with hex pubkey", async () => {
      const result = await parseBlossomCommand(["list", testPubkey]);
      expect(result.pubkey).toBe(testPubkey);
    });

    it("should parse list with npub", async () => {
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const result = await parseBlossomCommand(["list", npub]);
      expect(result.pubkey).toBe(testPubkey);
    });

    it("should parse list with $me alias", async () => {
      const result = await parseBlossomCommand(["list", "$me"], testPubkey);
      expect(result.pubkey).toBe(testPubkey);
    });

    it("should parse list with NIP-05 identifier", async () => {
      const resolvedPubkey =
        "0000000000000000000000000000000000000000000000000000000000000001";
      mockResolveNip05.mockResolvedValueOnce(resolvedPubkey);

      const result = await parseBlossomCommand(["list", "fiatjaf@fiatjaf.com"]);
      expect(mockResolveNip05).toHaveBeenCalledWith("fiatjaf@fiatjaf.com");
      expect(result.pubkey).toBe(resolvedPubkey);
    });

    it("should parse list with bare domain NIP-05", async () => {
      const resolvedPubkey =
        "0000000000000000000000000000000000000000000000000000000000000001";
      mockResolveNip05.mockResolvedValueOnce(resolvedPubkey);

      const result = await parseBlossomCommand(["list", "fiatjaf.com"]);
      expect(mockResolveNip05).toHaveBeenCalledWith("fiatjaf.com");
      expect(result.pubkey).toBe(resolvedPubkey);
    });

    it("should throw error for invalid pubkey format", async () => {
      mockResolveNip05.mockResolvedValueOnce(null);

      await expect(parseBlossomCommand(["list", "invalid"])).rejects.toThrow(
        "Invalid pubkey format",
      );
    });
  });

  describe("blob subcommand", () => {
    const validSha256 =
      "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553";

    it("should parse blob with sha256", async () => {
      const result = await parseBlossomCommand(["blob", validSha256]);
      expect(result.subcommand).toBe("blob");
      expect(result.sha256).toBe(validSha256);
      expect(result.serverUrl).toBeUndefined();
    });

    it("should parse blob alias 'view'", async () => {
      const result = await parseBlossomCommand(["view", validSha256]);
      expect(result.subcommand).toBe("blob");
    });

    it("should parse blob with server URL", async () => {
      const result = await parseBlossomCommand([
        "blob",
        validSha256,
        "blossom.primal.net",
      ]);
      expect(result.sha256).toBe(validSha256);
      expect(result.serverUrl).toBe("https://blossom.primal.net");
    });

    it("should lowercase sha256", async () => {
      const upperSha256 = validSha256.toUpperCase();
      const result = await parseBlossomCommand(["blob", upperSha256]);
      expect(result.sha256).toBe(validSha256);
    });

    it("should throw error when sha256 missing", async () => {
      await expect(parseBlossomCommand(["blob"])).rejects.toThrow(
        "SHA256 hash required",
      );
    });

    it("should throw error for invalid sha256", async () => {
      await expect(parseBlossomCommand(["blob", "invalid"])).rejects.toThrow(
        "Invalid SHA256 hash",
      );
    });

    it("should throw error for sha256 with wrong length", async () => {
      await expect(parseBlossomCommand(["blob", "abc123"])).rejects.toThrow(
        "Invalid SHA256 hash",
      );
    });
  });

  describe("mirror subcommand", () => {
    it("should parse mirror with source and target", async () => {
      const result = await parseBlossomCommand([
        "mirror",
        "https://source.com/blob",
        "target.com",
      ]);
      expect(result.subcommand).toBe("mirror");
      expect(result.sourceUrl).toBe("https://source.com/blob");
      expect(result.targetServer).toBe("https://target.com");
    });

    it("should throw error when source URL missing", async () => {
      await expect(parseBlossomCommand(["mirror"])).rejects.toThrow(
        "Source URL and target server required",
      );
    });

    it("should throw error when target server missing", async () => {
      await expect(
        parseBlossomCommand(["mirror", "https://source.com/blob"]),
      ).rejects.toThrow("Source URL and target server required");
    });
  });

  describe("delete subcommand", () => {
    const validSha256 =
      "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553";

    it("should parse delete with sha256 and server", async () => {
      const result = await parseBlossomCommand([
        "delete",
        validSha256,
        "blossom.primal.net",
      ]);
      expect(result.subcommand).toBe("delete");
      expect(result.sha256).toBe(validSha256);
      expect(result.serverUrl).toBe("https://blossom.primal.net");
    });

    it("should parse delete alias 'rm'", async () => {
      const result = await parseBlossomCommand([
        "rm",
        validSha256,
        "server.com",
      ]);
      expect(result.subcommand).toBe("delete");
    });

    it("should throw error when sha256 missing", async () => {
      await expect(parseBlossomCommand(["delete"])).rejects.toThrow(
        "SHA256 hash and server required",
      );
    });

    it("should throw error when server missing", async () => {
      await expect(
        parseBlossomCommand(["delete", validSha256]),
      ).rejects.toThrow("SHA256 hash and server required");
    });

    it("should throw error for invalid sha256", async () => {
      await expect(
        parseBlossomCommand(["delete", "invalid", "server.com"]),
      ).rejects.toThrow("Invalid SHA256 hash");
    });
  });

  describe("unknown subcommand", () => {
    it("should throw error with help text for unknown subcommand", async () => {
      await expect(parseBlossomCommand(["unknown"])).rejects.toThrow(
        /Unknown subcommand: unknown/,
      );
    });

    it("should include available subcommands in error", async () => {
      try {
        await parseBlossomCommand(["invalid"]);
      } catch (e) {
        const error = e as Error;
        expect(error.message).toContain("servers");
        expect(error.message).toContain("server <url>");
        expect(error.message).toContain("upload");
        expect(error.message).toContain("list");
        expect(error.message).toContain("blob");
        expect(error.message).toContain("mirror");
        expect(error.message).toContain("delete");
      }
    });
  });

  describe("case insensitivity", () => {
    it("should handle uppercase subcommands", async () => {
      const result = await parseBlossomCommand(["SERVERS"]);
      expect(result.subcommand).toBe("servers");
    });

    it("should handle mixed case subcommands", async () => {
      const result = await parseBlossomCommand(["Upload"]);
      expect(result.subcommand).toBe("upload");
    });
  });
});
