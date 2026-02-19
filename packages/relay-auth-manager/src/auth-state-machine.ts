import type { AuthPreference, AuthStatus } from "./types.js";

/**
 * Events that trigger auth state transitions.
 */
export type AuthEvent =
  | {
      type: "CHALLENGE_RECEIVED";
      challenge: string;
      preference?: AuthPreference;
    }
  | { type: "USER_ACCEPTED" }
  | { type: "USER_REJECTED" }
  | { type: "AUTH_SUCCESS" }
  | { type: "AUTH_FAILED" }
  | { type: "DISCONNECTED" };

/**
 * Result of an auth state transition.
 */
export interface AuthTransitionResult {
  /** The new auth status after the transition */
  newStatus: AuthStatus;
  /** True if the manager should automatically authenticate (preference is "always") */
  shouldAutoAuth: boolean;
  /** True if the current challenge should be cleared */
  clearChallenge: boolean;
}

/**
 * Pure function implementing the NIP-42 auth state machine.
 *
 * @param currentStatus - Current auth status
 * @param event - Event triggering the transition
 * @returns Transition result with new status and side-effect flags
 */
export function transitionAuthState(
  currentStatus: AuthStatus,
  event: AuthEvent,
): AuthTransitionResult {
  const noChange: AuthTransitionResult = {
    newStatus: currentStatus,
    shouldAutoAuth: false,
    clearChallenge: false,
  };

  switch (currentStatus) {
    case "none":
      if (event.type === "CHALLENGE_RECEIVED") {
        if (event.preference === "always") {
          return {
            newStatus: "authenticating",
            shouldAutoAuth: true,
            clearChallenge: false,
          };
        } else if (event.preference === "never") {
          return {
            newStatus: "rejected",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        } else {
          return {
            newStatus: "challenge_received",
            shouldAutoAuth: false,
            clearChallenge: false,
          };
        }
      }
      return noChange;

    case "challenge_received":
      switch (event.type) {
        case "USER_ACCEPTED":
          return {
            newStatus: "authenticating",
            shouldAutoAuth: false,
            clearChallenge: false,
          };
        case "USER_REJECTED":
          return {
            newStatus: "rejected",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        case "AUTH_SUCCESS":
          // Relay confirmed auth while prompt was still showing
          return {
            newStatus: "authenticated",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        case "DISCONNECTED":
          return {
            newStatus: "none",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        default:
          return noChange;
      }

    case "authenticating":
      switch (event.type) {
        case "AUTH_SUCCESS":
          return {
            newStatus: "authenticated",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        case "AUTH_FAILED":
          return {
            newStatus: "failed",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        case "DISCONNECTED":
          return {
            newStatus: "none",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        default:
          return noChange;
      }

    case "authenticated":
      if (event.type === "DISCONNECTED") {
        return {
          newStatus: "none",
          shouldAutoAuth: false,
          clearChallenge: true,
        };
      }
      if (event.type === "CHALLENGE_RECEIVED") {
        if (event.preference === "always") {
          return {
            newStatus: "authenticating",
            shouldAutoAuth: true,
            clearChallenge: false,
          };
        } else if (event.preference === "never") {
          return {
            newStatus: "rejected",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        }
        return {
          newStatus: "challenge_received",
          shouldAutoAuth: false,
          clearChallenge: false,
        };
      }
      return noChange;

    case "failed":
    case "rejected":
      if (event.type === "CHALLENGE_RECEIVED") {
        if (event.preference === "always") {
          return {
            newStatus: "authenticating",
            shouldAutoAuth: true,
            clearChallenge: false,
          };
        } else if (event.preference === "never") {
          return {
            newStatus: "rejected",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        }
        return {
          newStatus: "challenge_received",
          shouldAutoAuth: false,
          clearChallenge: false,
        };
      }
      if (event.type === "DISCONNECTED") {
        return {
          newStatus: "none",
          shouldAutoAuth: false,
          clearChallenge: true,
        };
      }
      return noChange;

    default: {
      const _exhaustive: never = currentStatus;
      return _exhaustive;
    }
  }
}
