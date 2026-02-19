import { describe, it, expect } from "vitest";
import { transitionAuthState, type AuthEvent } from "../auth-state-machine.js";
import type { AuthStatus } from "../types.js";

describe("Auth State Machine", () => {
  describe("none state", () => {
    it("should transition to challenge_received on challenge with ask preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
        preference: "ask",
      });
      expect(result.newStatus).toBe("challenge_received");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(false);
    });

    it("should transition to authenticating with always preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
        preference: "always",
      });
      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(true);
      expect(result.clearChallenge).toBe(false);
    });

    it("should transition to rejected with never preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
        preference: "never",
      });
      expect(result.newStatus).toBe("rejected");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should default to ask when no preference provided", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
      });
      expect(result.newStatus).toBe("challenge_received");
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should ignore AUTH_SUCCESS event", () => {
      const result = transitionAuthState("none", { type: "AUTH_SUCCESS" });
      expect(result.newStatus).toBe("none");
    });

    it("should ignore AUTH_FAILED event", () => {
      const result = transitionAuthState("none", { type: "AUTH_FAILED" });
      expect(result.newStatus).toBe("none");
    });

    it("should ignore USER_ACCEPTED event", () => {
      const result = transitionAuthState("none", { type: "USER_ACCEPTED" });
      expect(result.newStatus).toBe("none");
    });

    it("should ignore USER_REJECTED event", () => {
      const result = transitionAuthState("none", { type: "USER_REJECTED" });
      expect(result.newStatus).toBe("none");
    });

    it("should ignore DISCONNECTED event", () => {
      const result = transitionAuthState("none", { type: "DISCONNECTED" });
      expect(result.newStatus).toBe("none");
    });
  });

  describe("challenge_received state", () => {
    it("should transition to authenticating on USER_ACCEPTED", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_ACCEPTED",
      });
      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(false);
    });

    it("should transition to rejected on USER_REJECTED", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_REJECTED",
      });
      expect(result.newStatus).toBe("rejected");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to none on DISCONNECTED", () => {
      const result = transitionAuthState("challenge_received", {
        type: "DISCONNECTED",
      });
      expect(result.newStatus).toBe("none");
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to authenticated on AUTH_SUCCESS (relay confirmed auth while prompt showing)", () => {
      const result = transitionAuthState("challenge_received", {
        type: "AUTH_SUCCESS",
      });
      expect(result.newStatus).toBe("authenticated");
      expect(result.clearChallenge).toBe(true);
    });

    it("should ignore AUTH_FAILED event", () => {
      const result = transitionAuthState("challenge_received", {
        type: "AUTH_FAILED",
      });
      expect(result.newStatus).toBe("challenge_received");
    });
  });

  describe("authenticating state", () => {
    it("should transition to authenticated on AUTH_SUCCESS", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_SUCCESS",
      });
      expect(result.newStatus).toBe("authenticated");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to failed on AUTH_FAILED", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_FAILED",
      });
      expect(result.newStatus).toBe("failed");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to none on DISCONNECTED", () => {
      const result = transitionAuthState("authenticating", {
        type: "DISCONNECTED",
      });
      expect(result.newStatus).toBe("none");
      expect(result.clearChallenge).toBe(true);
    });

    it("should ignore USER_ACCEPTED event", () => {
      const result = transitionAuthState("authenticating", {
        type: "USER_ACCEPTED",
      });
      expect(result.newStatus).toBe("authenticating");
    });

    it("should ignore CHALLENGE_RECEIVED event", () => {
      const result = transitionAuthState("authenticating", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new",
      });
      expect(result.newStatus).toBe("authenticating");
    });
  });

  describe("authenticated state", () => {
    it("should transition to none on DISCONNECTED", () => {
      const result = transitionAuthState("authenticated", {
        type: "DISCONNECTED",
      });
      expect(result.newStatus).toBe("none");
      expect(result.clearChallenge).toBe(true);
    });

    it("should handle new challenge with always preference (re-auth)", () => {
      const result = transitionAuthState("authenticated", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "always",
      });
      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should auto-reject new challenge with never preference", () => {
      const result = transitionAuthState("authenticated", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "never",
      });
      expect(result.newStatus).toBe("rejected");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to challenge_received for new challenge with ask preference", () => {
      const result = transitionAuthState("authenticated", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "ask",
      });
      expect(result.newStatus).toBe("challenge_received");
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should transition to challenge_received for new challenge with no preference", () => {
      const result = transitionAuthState("authenticated", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
      });
      expect(result.newStatus).toBe("challenge_received");
    });

    it("should stay authenticated on AUTH_SUCCESS", () => {
      const result = transitionAuthState("authenticated", {
        type: "AUTH_SUCCESS",
      });
      expect(result.newStatus).toBe("authenticated");
    });

    it("should stay authenticated on USER_ACCEPTED", () => {
      const result = transitionAuthState("authenticated", {
        type: "USER_ACCEPTED",
      });
      expect(result.newStatus).toBe("authenticated");
    });
  });

  describe("failed state", () => {
    it("should transition to challenge_received on new challenge", () => {
      const result = transitionAuthState("failed", {
        type: "CHALLENGE_RECEIVED",
        challenge: "retry-challenge",
        preference: "ask",
      });
      expect(result.newStatus).toBe("challenge_received");
    });

    it("should auto-auth on new challenge with always preference", () => {
      const result = transitionAuthState("failed", {
        type: "CHALLENGE_RECEIVED",
        challenge: "retry-challenge",
        preference: "always",
      });
      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should transition to rejected with never preference", () => {
      const result = transitionAuthState("failed", {
        type: "CHALLENGE_RECEIVED",
        challenge: "retry-challenge",
        preference: "never",
      });
      expect(result.newStatus).toBe("rejected");
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to none on DISCONNECTED", () => {
      const result = transitionAuthState("failed", {
        type: "DISCONNECTED",
      });
      expect(result.newStatus).toBe("none");
    });

    it("should ignore USER_ACCEPTED event", () => {
      const result = transitionAuthState("failed", {
        type: "USER_ACCEPTED",
      });
      expect(result.newStatus).toBe("failed");
    });
  });

  describe("rejected state", () => {
    it("should handle new challenge after rejection", () => {
      const result = transitionAuthState("rejected", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "ask",
      });
      expect(result.newStatus).toBe("challenge_received");
    });

    it("should auto-auth on new challenge with always preference", () => {
      const result = transitionAuthState("rejected", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "always",
      });
      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should stay rejected with never preference", () => {
      const result = transitionAuthState("rejected", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "never",
      });
      expect(result.newStatus).toBe("rejected");
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to none on DISCONNECTED", () => {
      const result = transitionAuthState("rejected", {
        type: "DISCONNECTED",
      });
      expect(result.newStatus).toBe("none");
    });
  });

  describe("clearChallenge flag", () => {
    it("should clear on auth success", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_SUCCESS",
      });
      expect(result.clearChallenge).toBe(true);
    });

    it("should clear on auth failure", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_FAILED",
      });
      expect(result.clearChallenge).toBe(true);
    });

    it("should clear on user rejection", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_REJECTED",
      });
      expect(result.clearChallenge).toBe(true);
    });

    it("should clear on disconnect from any auth state", () => {
      const statesWithChallenge: AuthStatus[] = [
        "challenge_received",
        "authenticating",
        "authenticated",
        "failed",
        "rejected",
      ];
      for (const status of statesWithChallenge) {
        const result = transitionAuthState(status, { type: "DISCONNECTED" });
        expect(result.clearChallenge).toBe(true);
      }
    });

    it("should not clear when receiving new challenge", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
      });
      expect(result.clearChallenge).toBe(false);
    });

    it("should clear when never preference auto-rejects", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "never",
      });
      expect(result.clearChallenge).toBe(true);
    });
  });

  describe("shouldAutoAuth flag", () => {
    it("should be true only with always preference from none", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "always",
      });
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should be true with always preference from failed", () => {
      const result = transitionAuthState("failed", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "always",
      });
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should be true with always preference from rejected", () => {
      const result = transitionAuthState("rejected", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "always",
      });
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should be true with always preference from authenticated", () => {
      const result = transitionAuthState("authenticated", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new",
        preference: "always",
      });
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should be false with ask preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "ask",
      });
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should be false with never preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "never",
      });
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should be false on manual user acceptance", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_ACCEPTED",
      });
      expect(result.shouldAutoAuth).toBe(false);
    });
  });

  describe("exhaustive state coverage", () => {
    const allStates: AuthStatus[] = [
      "none",
      "challenge_received",
      "authenticating",
      "authenticated",
      "failed",
      "rejected",
    ];
    const allEvents: AuthEvent[] = [
      { type: "CHALLENGE_RECEIVED", challenge: "test" },
      { type: "CHALLENGE_RECEIVED", challenge: "test", preference: "always" },
      { type: "CHALLENGE_RECEIVED", challenge: "test", preference: "never" },
      { type: "USER_ACCEPTED" },
      { type: "USER_REJECTED" },
      { type: "AUTH_SUCCESS" },
      { type: "AUTH_FAILED" },
      { type: "DISCONNECTED" },
    ];

    it("should return a valid status for every state/event combination", () => {
      for (const state of allStates) {
        for (const event of allEvents) {
          const result = transitionAuthState(state, event);
          expect(allStates).toContain(result.newStatus);
          expect(typeof result.shouldAutoAuth).toBe("boolean");
          expect(typeof result.clearChallenge).toBe("boolean");
        }
      }
    });
  });
});
