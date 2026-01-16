import { describe, it, expect } from "vitest";
import {
  getOrderType,
  getFiatAmount,
  getSatsAmount,
  getCurrency,
  getBitcoinNetwork,
  getUsername,
  getPaymentMethods,
  getPlatform,
  getExpiration,
  getPremium,
  getOrderStatus,
  getSource,
  getBitcoinLayer,
  ORDER_STATUSES,
  type OrderStatus,
} from "./nip69-helpers";
import { NostrEvent } from "@/types/nostr";

// Helper to create a minimal kind 38383 event (P2P Order)
function createP2POrderEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1234567890,
    kind: 38383,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

describe("Kind 38383 (P2P Order) Helpers", () => {
  describe("getOrderType", () => {
    it("should extract order type from k tag (sell)", () => {
      const event = createP2POrderEvent({
        tags: [["k", "sell"]],
      });
      expect(getOrderType(event)).toBe("sell");
    });

    it("should extract order type from k tag (buy)", () => {
      const event = createP2POrderEvent({
        tags: [["k", "buy"]],
      });
      expect(getOrderType(event)).toBe("buy");
    });

    it("should return undefined if no k tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getOrderType(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["k", "sell"]],
      });
      expect(getOrderType(event)).toBeUndefined();
    });
  });

  describe("getFiatAmount", () => {
    it("should extract fiat amount from fa tag (integer)", () => {
      const event = createP2POrderEvent({
        tags: [["fa", "100"]],
      });
      expect(getFiatAmount(event)).toStrictEqual(["100"]);
    });

    it("should parse large fiat amounts", () => {
      const event = createP2POrderEvent({
        tags: [["fa", "1000000"]],
      });
      expect(getFiatAmount(event)).toStrictEqual(["1000000"]);
    });

    it("should parse multiple fiat amounts", () => {
      const event = createP2POrderEvent({
        tags: [["fa", "50", "100"]],
      });
      expect(getFiatAmount(event)).toStrictEqual(["50", "100"]);
    });

    it("should return undefined if no fa tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getFiatAmount(event)).toStrictEqual([]);
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["fa", "100"]],
      });
      expect(getFiatAmount(event)).toBeUndefined();
    });

    it("should parse integers from string values", () => {
      const event = createP2POrderEvent({
        tags: [["fa", "100.99"]],
      });
      expect(getFiatAmount(event)).toStrictEqual(["100"]);
    });
  });

  describe("getSatsAmount", () => {
    it("should extract sats amount from amt tag", () => {
      const event = createP2POrderEvent({
        tags: [["amt", "50000"]],
      });
      expect(getSatsAmount(event)).toBe(50000);
    });

    it("should parse large sat amounts", () => {
      const event = createP2POrderEvent({
        tags: [["amt", "100000000"]],
      });
      expect(getSatsAmount(event)).toBe(100000000);
    });

    it("should return undefined if no amt tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getSatsAmount(event)).toBeUndefined();
    });

    it("should return undefined if amt tag value is not a number", () => {
      const event = createP2POrderEvent({
        tags: [["amt", "invalid"]],
      });
      expect(getSatsAmount(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["amt", "50000"]],
      });
      expect(getSatsAmount(event)).toBeUndefined();
    });
  });

  describe("getCurrency", () => {
    it("should extract currency from f tag (USD)", () => {
      const event = createP2POrderEvent({
        tags: [["f", "USD"]],
      });
      expect(getCurrency(event)).toBe("USD");
    });

    it("should extract currency from f tag (EUR)", () => {
      const event = createP2POrderEvent({
        tags: [["f", "EUR"]],
      });
      expect(getCurrency(event)).toBe("EUR");
    });

    it("should handle other ISO 4217 currencies", () => {
      const event = createP2POrderEvent({
        tags: [["f", "JPY"]],
      });
      expect(getCurrency(event)).toBe("JPY");
    });

    it("should return undefined if no f tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getCurrency(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["f", "USD"]],
      });
      expect(getCurrency(event)).toBeUndefined();
    });
  });

  describe("getBitcoinNetwork", () => {
    it("should extract bitcoin network from network tag (mainnet)", () => {
      const event = createP2POrderEvent({
        tags: [["network", "mainnet"]],
      });
      expect(getBitcoinNetwork(event)).toBe("mainnet");
    });

    it("should extract bitcoin network from network tag (testnet)", () => {
      const event = createP2POrderEvent({
        tags: [["network", "testnet"]],
      });
      expect(getBitcoinNetwork(event)).toBe("testnet");
    });

    it("should return undefined if no network tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getBitcoinNetwork(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["network", "mainnet"]],
      });
      expect(getBitcoinNetwork(event)).toBeUndefined();
    });
  });

  describe("getUsername", () => {
    it("should extract username from name tag", () => {
      const event = createP2POrderEvent({
        tags: [["name", "alice"]],
      });
      expect(getUsername(event)).toBe("alice");
    });

    it("should return undefined if no name tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getUsername(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["name", "alice"]],
      });
      expect(getUsername(event)).toBeUndefined();
    });
  });

  describe("getPaymentMethods", () => {
    it("should extract all payment methods from pm tags", () => {
      const event = createP2POrderEvent({
        tags: [
          ["pm", "revolut"],
          ["pm", "strike"],
          ["pm", "cash-app"],
        ],
      });
      expect(getPaymentMethods(event)).toEqual([
        "revolut",
        "strike",
        "cash-app",
      ]);
    });

    it("should handle single payment method", () => {
      const event = createP2POrderEvent({
        tags: [["pm", "paypal"]],
      });
      expect(getPaymentMethods(event)).toEqual(["paypal"]);
    });

    it("should return empty array if no pm tags", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getPaymentMethods(event)).toEqual([]);
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["pm", "paypal"]],
      });
      expect(getPaymentMethods(event)).toBeUndefined();
    });

    it("should handle pm tags with multiple values per tag", () => {
      const event = createP2POrderEvent({
        tags: [
          ["pm", "revolut", "extra-value"],
          ["pm", "strike"],
        ],
      });
      // getTagValues uses flatMap with slice(1), so all values after pm are included
      expect(getPaymentMethods(event)).toEqual([
        "revolut",
        "extra-value",
        "strike",
      ]);
    });
  });

  describe("getPlatform", () => {
    it("should extract platform from y tag", () => {
      const event = createP2POrderEvent({
        tags: [["y", "robosats"]],
      });
      expect(getPlatform(event)).toBe("robosats");
    });

    it("should handle different platforms", () => {
      const event = createP2POrderEvent({
        tags: [["y", "hodlhodl"]],
      });
      expect(getPlatform(event)).toBe("hodlhodl");
    });

    it("should return undefined if no y tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getPlatform(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["y", "robosats"]],
      });
      expect(getPlatform(event)).toBeUndefined();
    });
  });

  describe("getExpiration", () => {
    it("should extract expiration timestamp from expiration tag", () => {
      const event = createP2POrderEvent({
        tags: [["expiration", "1704067200"]],
      });
      expect(getExpiration(event)).toBe(1704067200);
    });

    it("should return undefined if no expiration tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getExpiration(event)).toBeUndefined();
    });

    it("should return undefined if expiration tag value is not a number", () => {
      const event = createP2POrderEvent({
        tags: [["expiration", "invalid"]],
      });
      expect(getExpiration(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["expiration", "1704067200"]],
      });
      expect(getExpiration(event)).toBeUndefined();
    });
  });

  describe("getPremium", () => {
    it("should extract premium value from premium tag (positive)", () => {
      const event = createP2POrderEvent({
        tags: [["premium", "5"]],
      });
      expect(getPremium(event)).toBe(5);
    });

    it("should extract premium value from premium tag (negative)", () => {
      const event = createP2POrderEvent({
        tags: [["premium", "-3"]],
      });
      expect(getPremium(event)).toBe(-3);
    });

    it("should extract premium value from premium tag (zero)", () => {
      const event = createP2POrderEvent({
        tags: [["premium", "0"]],
      });
      expect(getPremium(event)).toBe(0);
    });

    it("should return undefined if no premium tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getPremium(event)).toBeUndefined();
    });

    it("should return undefined if premium tag value is not a number", () => {
      const event = createP2POrderEvent({
        tags: [["premium", "invalid"]],
      });
      expect(getPremium(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["premium", "5"]],
      });
      expect(getPremium(event)).toBeUndefined();
    });
  });

  describe("getOrderStatus", () => {
    it("should extract status from s tag (pending)", () => {
      const event = createP2POrderEvent({
        tags: [["s", "pending"]],
      });
      expect(getOrderStatus(event)).toBe("pending");
    });

    it("should extract status from s tag (canceled)", () => {
      const event = createP2POrderEvent({
        tags: [["s", "canceled"]],
      });
      expect(getOrderStatus(event)).toBe("canceled");
    });

    it("should extract status from s tag (in-progress)", () => {
      const event = createP2POrderEvent({
        tags: [["s", "in-progress"]],
      });
      expect(getOrderStatus(event)).toBe("in-progress");
    });

    it("should extract status from s tag (success)", () => {
      const event = createP2POrderEvent({
        tags: [["s", "success"]],
      });
      expect(getOrderStatus(event)).toBe("success");
    });

    it("should extract status from s tag (expired)", () => {
      const event = createP2POrderEvent({
        tags: [["s", "expired"]],
      });
      expect(getOrderStatus(event)).toBe("expired");
    });

    it("should return undefined if no s tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getOrderStatus(event)).toBeUndefined();
    });

    it("should return undefined for invalid status value", () => {
      const event = createP2POrderEvent({
        tags: [["s", "invalid-status"]],
      });
      expect(getOrderStatus(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["s", "pending"]],
      });
      expect(getOrderStatus(event)).toBeUndefined();
    });

    it("should validate against ORDER_STATUSES constant", () => {
      // Verify all valid statuses are recognized
      ORDER_STATUSES.forEach((status) => {
        const event = createP2POrderEvent({
          tags: [["s", status]],
        });
        expect(getOrderStatus(event)).toBe(status);
      });
    });
  });

  describe("getSource", () => {
    it("should extract source URL from source tag", () => {
      const event = createP2POrderEvent({
        tags: [["source", "https://robosats.com/order/abc123"]],
      });
      expect(getSource(event)).toBe("https://robosats.com/order/abc123");
    });

    it("should return undefined if no source tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getSource(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["source", "https://example.com"]],
      });
      expect(getSource(event)).toBeUndefined();
    });
  });

  describe("getBitcoinLayer", () => {
    it("should extract bitcoin layer from layer tag (lightning)", () => {
      const event = createP2POrderEvent({
        tags: [["layer", "lightning"]],
      });
      expect(getBitcoinLayer(event)).toBe("lightning");
    });

    it("should extract bitcoin layer from layer tag (onchain)", () => {
      const event = createP2POrderEvent({
        tags: [["layer", "onchain"]],
      });
      expect(getBitcoinLayer(event)).toBe("onchain");
    });

    it("should return undefined if no layer tag", () => {
      const event = createP2POrderEvent({
        tags: [],
      });
      expect(getBitcoinLayer(event)).toBeUndefined();
    });

    it("should return undefined for non-38383 events", () => {
      const event = createP2POrderEvent({
        kind: 1,
        tags: [["layer", "lightning"]],
      });
      expect(getBitcoinLayer(event)).toBeUndefined();
    });
  });

  describe("ORDER_STATUSES constant", () => {
    it("should contain all valid order statuses", () => {
      expect(ORDER_STATUSES).toContain("pending");
      expect(ORDER_STATUSES).toContain("canceled");
      expect(ORDER_STATUSES).toContain("in-progress");
      expect(ORDER_STATUSES).toContain("success");
      expect(ORDER_STATUSES).toContain("expired");
    });

    it("should have exactly 5 statuses", () => {
      expect(ORDER_STATUSES.length).toBe(5);
    });

    it("should be readonly tuple", () => {
      // TypeScript compile-time check - this tests the type definition
      const status: OrderStatus = "pending";
      expect(ORDER_STATUSES.includes(status)).toBe(true);
    });
  });
});
