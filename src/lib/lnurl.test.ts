import { describe, it, expect } from "vitest";
import { validateZapSupport, type LnUrlPayResponse } from "./lnurl";

describe("validateZapSupport", () => {
  const validLnurlData: LnUrlPayResponse = {
    callback: "https://example.com/lnurl/callback",
    maxSendable: 100000000,
    minSendable: 1000,
    metadata: '[["text/plain","Zap me!"]]',
    tag: "payRequest",
    allowsNostr: true,
    nostrPubkey:
      "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  };

  describe("valid zap support", () => {
    it("should pass validation for valid zap-enabled LNURL", () => {
      expect(() => validateZapSupport(validLnurlData)).not.toThrow();
    });

    it("should pass validation with commentAllowed field", () => {
      const withComment: LnUrlPayResponse = {
        ...validLnurlData,
        commentAllowed: 280,
      };
      expect(() => validateZapSupport(withComment)).not.toThrow();
    });
  });

  describe("allowsNostr validation", () => {
    it("should throw if allowsNostr is false", () => {
      const noZaps: LnUrlPayResponse = {
        ...validLnurlData,
        allowsNostr: false,
      };

      expect(() => validateZapSupport(noZaps)).toThrow(
        "This Lightning address does not support Nostr zaps",
      );
    });

    it("should throw if allowsNostr is missing", () => {
      const noFlag: LnUrlPayResponse = {
        ...validLnurlData,
        allowsNostr: undefined,
      };

      expect(() => validateZapSupport(noFlag)).toThrow(
        "This Lightning address does not support Nostr zaps",
      );
    });
  });

  describe("nostrPubkey validation", () => {
    it("should throw if nostrPubkey is missing", () => {
      const noPubkey: LnUrlPayResponse = {
        ...validLnurlData,
        nostrPubkey: undefined,
      };

      expect(() => validateZapSupport(noPubkey)).toThrow(
        "LNURL service missing nostrPubkey",
      );
    });

    it("should throw if nostrPubkey is invalid hex (too short)", () => {
      const shortPubkey: LnUrlPayResponse = {
        ...validLnurlData,
        nostrPubkey: "abc123",
      };

      expect(() => validateZapSupport(shortPubkey)).toThrow(
        "Invalid nostrPubkey format",
      );
    });

    it("should throw if nostrPubkey is invalid hex (too long)", () => {
      const longPubkey: LnUrlPayResponse = {
        ...validLnurlData,
        nostrPubkey:
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459dextra",
      };

      expect(() => validateZapSupport(longPubkey)).toThrow(
        "Invalid nostrPubkey format",
      );
    });

    it("should throw if nostrPubkey contains non-hex characters", () => {
      const invalidChars: LnUrlPayResponse = {
        ...validLnurlData,
        nostrPubkey:
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa45zz",
      };

      expect(() => validateZapSupport(invalidChars)).toThrow(
        "Invalid nostrPubkey format",
      );
    });

    it("should accept uppercase hex pubkey", () => {
      const uppercasePubkey: LnUrlPayResponse = {
        ...validLnurlData,
        nostrPubkey:
          "3BF0C63FCB93463407AF97A5E5EE64FA883D107EF9E558472C4EB9AAAEFA459D",
      };

      expect(() => validateZapSupport(uppercasePubkey)).not.toThrow();
    });

    it("should accept mixed case hex pubkey", () => {
      const mixedCasePubkey: LnUrlPayResponse = {
        ...validLnurlData,
        nostrPubkey:
          "3Bf0C63fcB93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459D",
      };

      expect(() => validateZapSupport(mixedCasePubkey)).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle all optional fields as undefined", () => {
      const minimal: LnUrlPayResponse = {
        callback: "https://example.com/callback",
        maxSendable: 1000000,
        minSendable: 1000,
        metadata: '[["text/plain","Minimal"]]',
        tag: "payRequest",
        allowsNostr: true,
        nostrPubkey:
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
        commentAllowed: undefined,
      };

      expect(() => validateZapSupport(minimal)).not.toThrow();
    });
  });
});
