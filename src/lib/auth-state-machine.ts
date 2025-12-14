import type { AuthStatus, AuthPreference } from "@/types/relay-state";

/**
 * Events that trigger auth state transitions
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
 * Result of an auth state transition
 */
export interface AuthTransitionResult {
  newStatus: AuthStatus;
  shouldAutoAuth: boolean; // True if preference is "always" and should auto-authenticate
  clearChallenge: boolean; // True if challenge should be cleared
}

/**
 * Pure function implementing the auth state machine
 * @param currentStatus - Current auth status
 * @param event - Event triggering the transition
 * @returns New state and any side effects to perform
 */
export function transitionAuthState(
  currentStatus: AuthStatus,
  event: AuthEvent,
): AuthTransitionResult {
  // Default result - no change
  const noChange: AuthTransitionResult = {
    newStatus: currentStatus,
    shouldAutoAuth: false,
    clearChallenge: false,
  };

  switch (currentStatus) {
    case "none":
      if (event.type === "CHALLENGE_RECEIVED") {
        // Check if we should auto-authenticate based on preference
        if (event.preference === "always") {
          return {
            newStatus: "authenticating",
            shouldAutoAuth: true,
            clearChallenge: false,
          };
        } else if (event.preference === "never") {
          // Immediately reject if preference is never
          return {
            newStatus: "rejected",
            shouldAutoAuth: false,
            clearChallenge: true,
          };
        } else {
          // Default: ask user
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
      // If we get a new challenge while authenticated, transition to challenge_received
      if (event.type === "CHALLENGE_RECEIVED") {
        if (event.preference === "always") {
          return {
            newStatus: "authenticating",
            shouldAutoAuth: true,
            clearChallenge: false,
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
      // Can receive new challenge after failure/rejection
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
      // Exhaustive check
      const _exhaustive: never = currentStatus;
      return _exhaustive;
    }
  }
}
