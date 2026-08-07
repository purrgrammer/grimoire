// Types for global relay state management

export type ConnectionState =
  "disconnected" | "connecting" | "connected" | "error";

export type AuthStatus =
  | "none" // No auth interaction yet
  | "challenge_received" // Challenge received, waiting for user decision
  | "authenticating" // Signing and sending AUTH event
  | "authenticated" // Successfully authenticated
  | "rejected" // User rejected auth
  | "failed"; // Authentication failed

export type AuthPreference = "always" | "never" | "ask";

export interface RelayChallenge {
  challenge: string;
  receivedAt: number;
}

export interface RelayNotice {
  message: string;
  timestamp: number;
}

export type ErrorType = "network" | "authentication" | "protocol" | "unknown";

export interface RelayError {
  message: string;
  timestamp: number;
  type: ErrorType;
  dismissed?: boolean;
}

export interface RelayStats {
  connectionsCount: number;
  authAttemptsCount: number;
  authSuccessCount: number;
}

export interface RelayState {
  url: string;
  connectionState: ConnectionState;
  authStatus: AuthStatus;
  authPreference?: AuthPreference;
  currentChallenge?: RelayChallenge;
  lastConnected?: number;
  lastDisconnected?: number;
  lastAuthenticated?: number;
  notices: RelayNotice[];
  errors: RelayError[];
  stats: RelayStats;
}

export interface PendingAuthChallenge {
  relayUrl: string;
  challenge: string;
  receivedAt: number;
}

export interface GlobalRelayState {
  relays: Record<string, RelayState>;
  pendingChallenges: PendingAuthChallenge[];
  authPreferences: Record<string, AuthPreference>;
}
