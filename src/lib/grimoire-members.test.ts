import { describe, it, expect } from "vitest";
import {
  GRIMOIRE_MEMBERS,
  isGrimoireMember,
  getGrimoireMember,
  getGrimoireMemberByNip05,
  getGrimoireUsername,
  getGrimoireNip05,
} from "./grimoire-members";

describe("Grimoire Members", () => {
  const underscorePubkey =
    "ce3cd5ba3ae52cec4e4b267fb29f1d2a526a5f4b8e8475d8a603a63c8925295f";
  const verbirichaPubkey =
    "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194";
  const randomPubkey =
    "0000000000000000000000000000000000000000000000000000000000000000";

  describe("GRIMOIRE_MEMBERS", () => {
    it("should contain exactly 2 members", () => {
      expect(GRIMOIRE_MEMBERS).toHaveLength(2);
    });

    it("should have correct structure for all members", () => {
      for (const member of GRIMOIRE_MEMBERS) {
        expect(member).toHaveProperty("username");
        expect(member).toHaveProperty("pubkey");
        expect(member).toHaveProperty("nip05");
        expect(typeof member.username).toBe("string");
        expect(typeof member.pubkey).toBe("string");
        expect(typeof member.nip05).toBe("string");
        expect(member.pubkey).toHaveLength(64); // Hex pubkey
      }
    });
  });

  describe("isGrimoireMember", () => {
    it("should return true for _ member", () => {
      expect(isGrimoireMember(underscorePubkey)).toBe(true);
    });

    it("should return true for verbiricha member", () => {
      expect(isGrimoireMember(verbirichaPubkey)).toBe(true);
    });

    it("should return false for non-member", () => {
      expect(isGrimoireMember(randomPubkey)).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isGrimoireMember(underscorePubkey.toUpperCase())).toBe(true);
      expect(isGrimoireMember(verbirichaPubkey.toUpperCase())).toBe(true);
    });
  });

  describe("getGrimoireMember", () => {
    it("should return member info for _ username", () => {
      const member = getGrimoireMember(underscorePubkey);
      expect(member).toBeDefined();
      expect(member?.username).toBe("_");
      expect(member?.pubkey).toBe(underscorePubkey);
      expect(member?.nip05).toBe("_@grimoire.pro");
    });

    it("should return member info for verbiricha username", () => {
      const member = getGrimoireMember(verbirichaPubkey);
      expect(member).toBeDefined();
      expect(member?.username).toBe("verbiricha");
      expect(member?.pubkey).toBe(verbirichaPubkey);
      expect(member?.nip05).toBe("verbiricha@grimoire.pro");
    });

    it("should return undefined for non-member", () => {
      const member = getGrimoireMember(randomPubkey);
      expect(member).toBeUndefined();
    });

    it("should be case-insensitive", () => {
      const member = getGrimoireMember(underscorePubkey.toUpperCase());
      expect(member).toBeDefined();
      expect(member?.username).toBe("_");
    });
  });

  describe("getGrimoireMemberByNip05", () => {
    it("should return member info for _@grimoire.pro", () => {
      const member = getGrimoireMemberByNip05("_@grimoire.pro");
      expect(member).toBeDefined();
      expect(member?.username).toBe("_");
      expect(member?.pubkey).toBe(underscorePubkey);
    });

    it("should return member info for verbiricha@grimoire.pro", () => {
      const member = getGrimoireMemberByNip05("verbiricha@grimoire.pro");
      expect(member).toBeDefined();
      expect(member?.username).toBe("verbiricha");
      expect(member?.pubkey).toBe(verbirichaPubkey);
    });

    it("should return undefined for non-member identifier", () => {
      const member = getGrimoireMemberByNip05("alice@example.com");
      expect(member).toBeUndefined();
    });

    it("should be case-insensitive", () => {
      const member = getGrimoireMemberByNip05("_@GRIMOIRE.PRO");
      expect(member).toBeDefined();
      expect(member?.username).toBe("_");
    });
  });

  describe("getGrimoireUsername", () => {
    it("should return username for member", () => {
      expect(getGrimoireUsername(underscorePubkey)).toBe("_");
      expect(getGrimoireUsername(verbirichaPubkey)).toBe("verbiricha");
    });

    it("should return undefined for non-member", () => {
      expect(getGrimoireUsername(randomPubkey)).toBeUndefined();
    });
  });

  describe("getGrimoireNip05", () => {
    it("should return NIP-05 for member", () => {
      expect(getGrimoireNip05(underscorePubkey)).toBe("_@grimoire.pro");
      expect(getGrimoireNip05(verbirichaPubkey)).toBe(
        "verbiricha@grimoire.pro",
      );
    });

    it("should return undefined for non-member", () => {
      expect(getGrimoireNip05(randomPubkey)).toBeUndefined();
    });
  });
});
