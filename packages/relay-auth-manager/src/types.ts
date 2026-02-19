import type { Observable } from "rxjs";

/**
 * Auth status for a relay's NIP-42 authentication state.
 */
export type AuthStatus =
  | "none" // No auth interaction yet
  | "challenge_received" // Challenge received, waiting for user decision
  | "authenticating" // Signing and sending AUTH event
  | "authenticated" // Successfully authenticated
  | "rejected" // User rejected auth
  | "failed"; // Authentication failed

/**
 * User's persistent auth preference for a relay.
 */
export type AuthPreference = "always" | "never" | "ask";

/**
 * Auth state for a single relay.
 */
export interface RelayAuthState {
  url: string;
  connected: boolean;
  status: AuthStatus;
  challenge: string | null;
  challengeReceivedAt: number | null;
}

/**
 * A pending auth challenge that needs user input.
 */
export interface PendingAuthChallenge {
  relayUrl: string;
  challenge: string;
  receivedAt: number;
}

/**
 * Minimal relay interface needed by RelayAuthManager.
 * Compatible with IRelay from applesauce-relay.
 */
export interface AuthRelay {
  url: string;
  connected$: Observable<boolean>;
  challenge$: Observable<string | null>;
  authenticated$: Observable<boolean>;
  readonly connected: boolean;
  readonly authenticated: boolean;
  readonly challenge: string | null;
  authenticate(signer: AuthSigner): Promise<unknown>;
}

/**
 * Signer interface for NIP-42 authentication.
 * Compatible with AuthSigner from applesauce-relay.
 */
export interface AuthSigner {
  signEvent(event: unknown): unknown | Promise<unknown>;
}

/**
 * Minimal pool interface needed by RelayAuthManager.
 * Compatible with RelayPool from applesauce-relay.
 */
export interface AuthRelayPool {
  /** Get or create a relay by URL */
  relay(url: string): AuthRelay;
  /** Emits when a relay is added to the pool */
  add$: Observable<AuthRelay>;
  /** Emits when a relay is removed from the pool */
  remove$: Observable<AuthRelay>;
}

/**
 * localStorage-like storage interface for persisting auth preferences.
 * Both localStorage and sessionStorage satisfy this interface.
 */
export interface AuthPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Options for RelayAuthManager constructor.
 */
export interface RelayAuthManagerOptions {
  /** Relay pool to monitor for auth challenges */
  pool: AuthRelayPool;

  /** Observable that emits the current signer. Emit null when signing is unavailable (e.g., read-only account or logged out). */
  signer$: Observable<AuthSigner | null>;

  /** Optional storage for persisting auth preferences across sessions */
  storage?: AuthPreferenceStorage;

  /** Key to use in storage (default: "relay-auth-preferences") */
  storageKey?: string;

  /** Challenge TTL in milliseconds (default: 300000 = 5 minutes) */
  challengeTTL?: number;

  /** Initial relays to monitor (for relays already in the pool at creation time) */
  initialRelays?: Iterable<AuthRelay>;

  /**
   * Custom URL normalizer for consistent relay URL matching.
   * Called on all URLs before they're used as Map keys (preferences, state, etc.).
   * Default: adds wss:// prefix and strips trailing slashes.
   *
   * Provide this if your app uses a different normalization (e.g., lowercase hostname,
   * trailing slash convention) to ensure preferences match relay state.
   */
  normalizeUrl?: (url: string) => string;
}
