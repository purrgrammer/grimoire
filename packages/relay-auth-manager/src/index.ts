export { RelayAuthManager } from "./relay-auth-manager.js";
export { transitionAuthState } from "./auth-state-machine.js";
export type { AuthEvent, AuthTransitionResult } from "./auth-state-machine.js";
export type {
  AuthStatus,
  AuthPreference,
  AuthSigner,
  AuthRelay,
  AuthRelayPool,
  AuthPreferenceStorage,
  RelayAuthState,
  RelayAuthManagerOptions,
  PendingAuthChallenge,
} from "./types.js";
