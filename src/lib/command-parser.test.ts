import { describe, it, expect } from "vitest";
import { parseCommandInput, executeCommandParser } from "./command-parser";

/**
 * Regression tests for parseCommandInput
 *
 * These tests document the current behavior to ensure we don't break
 * existing command parsing when we add global flag support.
 */
describe("parseCommandInput - regression tests", () => {
  describe("basic commands", () => {
    it("should parse simple command with no args", () => {
      const result = parseCommandInput("help");
      expect(result.commandName).toBe("help");
      expect(result.args).toEqual([]);
      expect(result.command).toBeDefined();
    });

    it("should parse command with single arg", () => {
      const result = parseCommandInput("nip 01");
      expect(result.commandName).toBe("nip");
      expect(result.args).toEqual(["01"]);
    });

    it("should parse command with multiple args", () => {
      const result = parseCommandInput("profile alice@domain.com");
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["alice@domain.com"]);
    });
  });

  describe("multi-word commands", () => {
    it("should parse two-word command 'relay admin'", () => {
      const result = parseCommandInput("relay admin wss://relay.example.com");
      expect(result.commandName).toBe("relay admin");
      expect(result.args).toEqual(["wss://relay.example.com"]);
      expect(result.command).toBeDefined();
      expect(result.command?.appId).toBe("relay-admin");
    });

    it("should fall back to single-word command if two-word doesn't exist", () => {
      const result = parseCommandInput("relay wss://relay.example.com");
      expect(result.commandName).toBe("relay");
      expect(result.args).toEqual(["wss://relay.example.com"]);
      expect(result.command?.appId).toBe("relay");
    });

    it("should handle multi-word command with no args", () => {
      const result = parseCommandInput("relay admin");
      expect(result.commandName).toBe("relay admin");
      expect(result.args).toEqual([]);
    });
  });

  describe("commands with flags", () => {
    it("should preserve req command with flags", () => {
      const result = parseCommandInput("req -k 1 -a alice");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-a", "alice"]);
    });

    it("should preserve comma-separated values", () => {
      const result = parseCommandInput("req -k 1,3,7 -l 50");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1,3,7", "-l", "50"]);
    });

    it("should handle long flag names", () => {
      const result = parseCommandInput("req --kind 1 --limit 20");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["--kind", "1", "--limit", "20"]);
    });

    it("should handle mixed short and long flags", () => {
      const result = parseCommandInput("req -k 1 --author alice -l 50");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "--author", "alice", "-l", "50"]);
    });
  });

  describe("commands with complex identifiers", () => {
    it("should handle hex pubkey", () => {
      const hexKey =
        "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
      const result = parseCommandInput(`profile ${hexKey}`);
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual([hexKey]);
    });

    it("should handle npub", () => {
      const npub = "npub1abc123def456";
      const result = parseCommandInput(`profile ${npub}`);
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual([npub]);
    });

    it("should handle nip05 identifier", () => {
      const result = parseCommandInput("profile alice@nostr.com");
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["alice@nostr.com"]);
    });

    it("should handle relay URL", () => {
      const result = parseCommandInput("relay wss://relay.damus.io");
      expect(result.commandName).toBe("relay");
      expect(result.args).toEqual(["wss://relay.damus.io"]);
    });
  });

  describe("special arguments", () => {
    it("should handle $me alias", () => {
      const result = parseCommandInput("req -k 1 -a $me");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-a", "$me"]);
    });

    it("should handle $contacts alias", () => {
      const result = parseCommandInput("req -k 1 -a $contacts");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-a", "$contacts"]);
    });
  });

  describe("whitespace handling", () => {
    it("should trim leading whitespace", () => {
      const result = parseCommandInput("   profile alice");
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["alice"]);
    });

    it("should trim trailing whitespace", () => {
      const result = parseCommandInput("profile alice   ");
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["alice"]);
    });

    it("should collapse multiple spaces", () => {
      const result = parseCommandInput("req  -k   1   -a    alice");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-a", "alice"]);
    });
  });

  describe("error cases", () => {
    it("should handle empty input", () => {
      const result = parseCommandInput("");
      expect(result.commandName).toBe("");
      expect(result.error).toBe("No command provided");
    });

    it("should handle unknown command", () => {
      const result = parseCommandInput("unknowncommand");
      expect(result.commandName).toBe("unknowncommand");
      expect(result.error).toContain("Unknown command");
    });
  });

  describe("case sensitivity", () => {
    it("should handle lowercase command", () => {
      const result = parseCommandInput("profile alice");
      expect(result.commandName).toBe("profile");
    });

    it("should handle uppercase command (converted to lowercase)", () => {
      const result = parseCommandInput("PROFILE alice");
      expect(result.commandName).toBe("profile");
    });

    it("should handle mixed case command", () => {
      const result = parseCommandInput("Profile alice");
      expect(result.commandName).toBe("profile");
    });
  });

  describe("real-world command examples", () => {
    it("req: get recent notes", () => {
      const result = parseCommandInput("req -k 1 -l 20");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-l", "20"]);
    });

    it("req: get notes from specific author", () => {
      const result = parseCommandInput("req -k 1 -a npub1abc... -l 50");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-a", "npub1abc...", "-l", "50"]);
    });

    it("req: complex filter", () => {
      const result = parseCommandInput(
        "req -k 1,3,7 -a alice@nostr.com -l 100 --since 24h",
      );
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual([
        "-k",
        "1,3,7",
        "-a",
        "alice@nostr.com",
        "-l",
        "100",
        "--since",
        "24h",
      ]);
    });

    it("profile: by npub", () => {
      const result = parseCommandInput("profile npub1abc...");
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["npub1abc..."]);
    });

    it("profile: by nip05", () => {
      const result = parseCommandInput("profile jack@cash.app");
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["jack@cash.app"]);
    });

    it("nip: view specification", () => {
      const result = parseCommandInput("nip 19");
      expect(result.commandName).toBe("nip");
      expect(result.args).toEqual(["19"]);
    });

    it("relay: view relay info", () => {
      const result = parseCommandInput("relay nos.lol");
      expect(result.commandName).toBe("relay");
      expect(result.args).toEqual(["nos.lol"]);
    });
  });

  describe("global flags - new functionality", () => {
    it("should extract --title flag", () => {
      const result = parseCommandInput('profile alice --title "My Window"');
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["alice"]);
      expect(result.globalFlags?.windowProps?.title).toBe("My Window");
    });

    it("should handle --title at start", () => {
      const result = parseCommandInput('--title "My Window" profile alice');
      expect(result.commandName).toBe("profile");
      expect(result.args).toEqual(["alice"]);
      expect(result.globalFlags?.windowProps?.title).toBe("My Window");
    });

    it("should handle --title in middle", () => {
      const result = parseCommandInput('req -k 1 --title "My Feed" -a alice');
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-a", "alice"]);
      expect(result.globalFlags?.windowProps?.title).toBe("My Feed");
    });

    it("should handle --title with single quotes", () => {
      const result = parseCommandInput("profile alice --title 'My Window'");
      expect(result.globalFlags?.windowProps?.title).toBe("My Window");
    });

    it("should handle --title without quotes (single word)", () => {
      const result = parseCommandInput("profile alice --title MyWindow");
      expect(result.globalFlags?.windowProps?.title).toBe("MyWindow");
    });

    it("should preserve command behavior when no --title", () => {
      const result = parseCommandInput("req -k 1 -a alice");
      expect(result.commandName).toBe("req");
      expect(result.args).toEqual(["-k", "1", "-a", "alice"]);
      expect(result.globalFlags).toEqual({});
    });

    it("should error when --title has no value", () => {
      const result = parseCommandInput("profile alice --title");
      expect(result.error).toContain("--title requires a value");
    });

    it("should handle emoji in --title", () => {
      const result = parseCommandInput('profile alice --title "👤 Alice"');
      expect(result.globalFlags?.windowProps?.title).toBe("👤 Alice");
    });
  });
});

describe("executeCommandParser - alias resolution", () => {
  it("should resolve $me in profile command when activeAccountPubkey is provided", async () => {
    const input = "profile $me";
    const parsed = parseCommandInput(input);
    const activeAccountPubkey =
      "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";

    const result = await executeCommandParser(parsed, activeAccountPubkey);

    expect(result.error).toBeUndefined();
    expect(result.props.pubkey).toBe(activeAccountPubkey);
  });

  it("should return $me literal in profile command when activeAccountPubkey is NOT provided", async () => {
    const input = "profile $me";
    const parsed = parseCommandInput(input);

    const result = await executeCommandParser(parsed);

    expect(result.error).toBeUndefined();
    expect(result.props.pubkey).toBe("$me");
  });
});
