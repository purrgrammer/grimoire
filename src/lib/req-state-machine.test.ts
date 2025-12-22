import { describe, it, expect } from "vitest";
import {
  deriveOverallState,
  getStatusText,
  getStatusTooltip,
  getStatusColor,
  shouldAnimate,
  getRelayStateBadge,
} from "./req-state-machine";
import type { ReqRelayState } from "@/types/req-state";

describe("deriveOverallState", () => {
  const queryStartedAt = Date.now();

  describe("discovering state", () => {
    it("should return discovering when no relays", () => {
      const state = deriveOverallState(new Map(), false, false, queryStartedAt);
      expect(state.status).toBe("discovering");
      expect(state.totalRelays).toBe(0);
    });
  });

  describe("connecting state", () => {
    it("should return connecting when relays pending with no events", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "pending",
            subscriptionState: "waiting",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe("connecting");
      expect(state.hasReceivedEvents).toBe(false);
      expect(state.hasActiveRelays).toBe(false);
    });

    it("should return connecting when relays connecting with no events", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connecting",
            subscriptionState: "waiting",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe("connecting");
    });
  });

  describe("failed state", () => {
    it("should return failed when all relays error with no events", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "error",
            subscriptionState: "error",
            eventCount: 0,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "error",
            subscriptionState: "error",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe("failed");
      expect(state.allRelaysFailed).toBe(true);
      expect(state.errorCount).toBe(2);
    });
  });

  describe("loading state", () => {
    it("should return loading when connected but no EOSE", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "receiving",
            eventCount: 5,
            firstEventAt: Date.now(),
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe("loading");
      expect(state.hasReceivedEvents).toBe(true);
      expect(state.hasActiveRelays).toBe(true);
      expect(state.receivingCount).toBe(1);
    });

    it("should return loading when waiting for events", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "waiting",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe("loading");
      expect(state.hasReceivedEvents).toBe(false);
      expect(state.connectedCount).toBe(1);
    });
  });

  describe("live state", () => {
    it("should return live when EOSE + streaming + connected", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "eose",
            eventCount: 10,
            eoseAt: Date.now(),
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe("live");
      expect(state.hasActiveRelays).toBe(true);
      expect(state.eoseCount).toBe(1);
    });

    it("should return live with multiple connected relays", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "connected",
            subscriptionState: "receiving",
            eventCount: 5,
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe("live");
      expect(state.connectedCount).toBe(2);
    });
  });

  describe("offline state", () => {
    it("should return offline when all disconnected after EOSE in streaming", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "disconnected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "disconnected",
            subscriptionState: "eose",
            eventCount: 5,
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe("offline");
      expect(state.hasActiveRelays).toBe(false);
      expect(state.hasReceivedEvents).toBe(true);
      expect(state.disconnectedCount).toBe(2);
    });

    it("should return offline when all errored after EOSE in streaming", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "error",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe("offline");
    });
  });

  describe("partial state", () => {
    it("should return partial when some relays ok, some failed after EOSE", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "error",
            subscriptionState: "error",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe("partial");
      expect(state.connectedCount).toBe(1);
      expect(state.errorCount).toBe(1);
    });

    it("should return partial when some disconnected after EOSE", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "disconnected",
            subscriptionState: "eose",
            eventCount: 5,
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe("partial");
      expect(state.disconnectedCount).toBe(1);
    });
  });

  describe("closed state", () => {
    it("should return closed when EOSE + not streaming", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "disconnected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, false, queryStartedAt);
      expect(state.status).toBe("closed");
    });

    it("should return closed when all relays disconnected after EOSE non-streaming", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "disconnected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "disconnected",
            subscriptionState: "eose",
            eventCount: 5,
          },
        ],
      ]);
      const state = deriveOverallState(relays, true, false, queryStartedAt);
      expect(state.status).toBe("closed");
    });
  });

  describe("edge cases from analysis", () => {
    it("Scenario 1: All relays disconnect immediately", () => {
      const relays = new Map<string, ReqRelayState>();
      for (let i = 0; i < 10; i++) {
        relays.set(`wss://relay${i}.com`, {
          url: `wss://relay${i}.com`,
          connectionState: "error",
          subscriptionState: "error",
          eventCount: 0,
        });
      }
      const state = deriveOverallState(relays, false, true, queryStartedAt);
      expect(state.status).toBe("failed");
      expect(state.allRelaysFailed).toBe(true);
    });

    it("Scenario 5: Streaming mode with gradual disconnections (THE BUG)", () => {
      // Start with all relays connected and receiving
      const relays = new Map<string, ReqRelayState>();
      for (let i = 0; i < 30; i++) {
        relays.set(`wss://relay${i}.com`, {
          url: `wss://relay${i}.com`,
          connectionState: "disconnected", // All disconnected
          subscriptionState: "eose",
          eventCount: 5, // Had events before
        });
      }
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      // Should be OFFLINE not LIVE
      expect(state.status).toBe("offline");
      expect(state.connectedCount).toBe(0);
      expect(state.totalRelays).toBe(30);
      expect(state.hasReceivedEvents).toBe(true);
    });

    it("Scenario 3: Mixed success/failure", () => {
      const relays = new Map<string, ReqRelayState>();
      // 10 succeed with EOSE
      for (let i = 0; i < 10; i++) {
        relays.set(`wss://success${i}.com`, {
          url: `wss://success${i}.com`,
          connectionState: "connected",
          subscriptionState: "eose",
          eventCount: 10,
        });
      }
      // 15 disconnect
      for (let i = 0; i < 15; i++) {
        relays.set(`wss://disconnect${i}.com`, {
          url: `wss://disconnect${i}.com`,
          connectionState: "disconnected",
          subscriptionState: "waiting",
          eventCount: 0,
        });
      }
      // 5 error
      for (let i = 0; i < 5; i++) {
        relays.set(`wss://error${i}.com`, {
          url: `wss://error${i}.com`,
          connectionState: "error",
          subscriptionState: "error",
          eventCount: 0,
        });
      }
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe("partial");
      expect(state.totalRelays).toBe(30);
      expect(state.connectedCount).toBe(10);
      expect(state.disconnectedCount).toBe(15);
      expect(state.errorCount).toBe(5);
    });

    it("NEW: All relays disconnect before EOSE, no events (streaming)", () => {
      // THE CRITICAL BUG: Stuck in LOADING when all relays disconnect
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "disconnected",
            subscriptionState: "waiting", // Never got to receiving/eose
            eventCount: 0,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "disconnected",
            subscriptionState: "waiting",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, true, queryStartedAt);
      // Should be FAILED, not LOADING
      expect(state.status).toBe("failed");
      expect(state.connectedCount).toBe(0);
      expect(state.hasReceivedEvents).toBe(false);
    });

    it("NEW: All relays disconnect before EOSE, with events (streaming)", () => {
      // Relays sent some events then disconnected before EOSE
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "disconnected",
            subscriptionState: "receiving", // Was receiving
            eventCount: 5,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "disconnected",
            subscriptionState: "receiving",
            eventCount: 3,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, true, queryStartedAt);
      // Should be OFFLINE (had events but all disconnected)
      expect(state.status).toBe("offline");
      expect(state.connectedCount).toBe(0);
      expect(state.hasReceivedEvents).toBe(true);
    });

    it("NEW: All relays disconnect before EOSE, with events (non-streaming)", () => {
      // Same as above but non-streaming
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "disconnected",
            subscriptionState: "receiving",
            eventCount: 5,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      // Should be CLOSED (non-streaming completes)
      expect(state.status).toBe("closed");
      expect(state.hasReceivedEvents).toBe(true);
    });

    it("NEW: Some relays EOSE, others disconnect before EOSE", () => {
      // Partial success before overall EOSE
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "disconnected",
            subscriptionState: "receiving",
            eventCount: 3,
          },
        ],
        [
          "wss://relay3.com",
          {
            url: "wss://relay3.com",
            connectionState: "error",
            subscriptionState: "error",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, true, queryStartedAt);
      // Should be PARTIAL (some succeeded, some failed, but not all terminal)
      expect(state.status).toBe("partial");
      expect(state.connectedCount).toBe(1);
      expect(state.eoseCount).toBe(1);
    });

    it("NEW: Mix of EOSE and errors, all terminal", () => {
      const relays = new Map<string, ReqRelayState>([
        [
          "wss://relay1.com",
          {
            url: "wss://relay1.com",
            connectionState: "connected",
            subscriptionState: "eose",
            eventCount: 10,
          },
        ],
        [
          "wss://relay2.com",
          {
            url: "wss://relay2.com",
            connectionState: "error",
            subscriptionState: "error",
            eventCount: 0,
          },
        ],
      ]);
      const state = deriveOverallState(relays, false, true, queryStartedAt);
      // All terminal (eose + error), should be PARTIAL
      expect(state.status).toBe("partial");
      expect(state.connectedCount).toBe(1);
    });
  });
});

describe("getStatusText", () => {
  const baseState = {
    totalRelays: 5,
    connectedCount: 3,
    receivingCount: 2,
    eoseCount: 1,
    errorCount: 0,
    disconnectedCount: 0,
    hasReceivedEvents: true,
    hasActiveRelays: true,
    allRelaysFailed: false,
    queryStartedAt: Date.now(),
  };

  it("should return correct text for each status", () => {
    expect(getStatusText({ ...baseState, status: "discovering" })).toBe(
      "DISCOVERING",
    );
    expect(getStatusText({ ...baseState, status: "connecting" })).toBe(
      "CONNECTING",
    );
    expect(getStatusText({ ...baseState, status: "loading" })).toBe("LOADING");
    expect(getStatusText({ ...baseState, status: "live" })).toBe("LIVE");
    expect(getStatusText({ ...baseState, status: "partial" })).toBe("PARTIAL");
    expect(getStatusText({ ...baseState, status: "offline" })).toBe("OFFLINE");
    expect(getStatusText({ ...baseState, status: "closed" })).toBe("CLOSED");
    expect(getStatusText({ ...baseState, status: "failed" })).toBe("FAILED");
  });
});

describe("getStatusTooltip", () => {
  const baseState = {
    totalRelays: 5,
    connectedCount: 3,
    receivingCount: 2,
    eoseCount: 1,
    errorCount: 0,
    disconnectedCount: 0,
    hasReceivedEvents: true,
    hasActiveRelays: true,
    allRelaysFailed: false,
    queryStartedAt: Date.now(),
  };

  it("should provide detailed tooltips", () => {
    const discovering = getStatusTooltip({
      ...baseState,
      status: "discovering",
    });
    expect(discovering).toContain("NIP-65");

    const loading = getStatusTooltip({ ...baseState, status: "loading" });
    expect(loading).toContain("3/5");

    const live = getStatusTooltip({ ...baseState, status: "live" });
    expect(live).toContain("Streaming");
    expect(live).toContain("3/5");

    const offline = getStatusTooltip({ ...baseState, status: "offline" });
    expect(offline).toContain("disconnected");
  });
});

describe("getStatusColor", () => {
  it("should return correct colors for each status", () => {
    expect(getStatusColor("discovering")).toBe("text-yellow-500");
    expect(getStatusColor("connecting")).toBe("text-yellow-500");
    expect(getStatusColor("loading")).toBe("text-yellow-500");
    expect(getStatusColor("live")).toBe("text-green-500");
    expect(getStatusColor("partial")).toBe("text-yellow-500");
    expect(getStatusColor("closed")).toBe("text-muted-foreground");
    expect(getStatusColor("offline")).toBe("text-red-500");
    expect(getStatusColor("failed")).toBe("text-red-500");
  });
});

describe("shouldAnimate", () => {
  it("should animate active states", () => {
    expect(shouldAnimate("discovering")).toBe(true);
    expect(shouldAnimate("connecting")).toBe(true);
    expect(shouldAnimate("loading")).toBe(true);
    expect(shouldAnimate("live")).toBe(true);
  });

  it("should not animate terminal states", () => {
    expect(shouldAnimate("partial")).toBe(false);
    expect(shouldAnimate("closed")).toBe(false);
    expect(shouldAnimate("offline")).toBe(false);
    expect(shouldAnimate("failed")).toBe(false);
  });
});

describe("getRelayStateBadge", () => {
  it("should return receiving badge", () => {
    const badge = getRelayStateBadge({
      url: "wss://relay.com",
      connectionState: "connected",
      subscriptionState: "receiving",
      eventCount: 5,
    });
    expect(badge?.text).toBe("RECEIVING");
    expect(badge?.color).toBe("text-green-500");
  });

  it("should return eose badge", () => {
    const badge = getRelayStateBadge({
      url: "wss://relay.com",
      connectionState: "connected",
      subscriptionState: "eose",
      eventCount: 10,
    });
    expect(badge?.text).toBe("EOSE");
    expect(badge?.color).toBe("text-blue-500");
  });

  it("should return error badge", () => {
    const badge = getRelayStateBadge({
      url: "wss://relay.com",
      connectionState: "error",
      subscriptionState: "error",
      eventCount: 0,
    });
    expect(badge?.text).toBe("ERROR");
    expect(badge?.color).toBe("text-red-500");
  });

  it("should return offline badge for disconnected", () => {
    const badge = getRelayStateBadge({
      url: "wss://relay.com",
      connectionState: "disconnected",
      subscriptionState: "waiting",
      eventCount: 0,
    });
    expect(badge?.text).toBe("OFFLINE");
    expect(badge?.color).toBe("text-muted-foreground");
  });

  it("should return null for connected waiting state", () => {
    const badge = getRelayStateBadge({
      url: "wss://relay.com",
      connectionState: "connected",
      subscriptionState: "waiting",
      eventCount: 0,
    });
    expect(badge).toBeNull();
  });
});
