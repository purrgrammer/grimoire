import { BehaviorSubject, type Subscription, combineLatest } from "rxjs";
import { startWith } from "rxjs/operators";
import { transitionAuthState, type AuthEvent } from "./auth-state-machine.js";
import type {
  AuthPreference,
  AuthRelay,
  AuthSigner,
  PendingAuthChallenge,
  RelayAuthManagerOptions,
  RelayAuthState,
} from "./types.js";

const DEFAULT_STORAGE_KEY = "relay-auth-preferences";
const DEFAULT_CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generic NIP-42 relay authentication manager.
 *
 * Monitors relays for AUTH challenges and manages the authentication lifecycle
 * including auto-auth, user prompts, preferences persistence, and signer lifecycle.
 *
 * Framework-agnostic: uses RxJS observables for reactivity, accepts pluggable
 * storage and signer via constructor injection.
 */
export class RelayAuthManager {
  private readonly storageKey: string;
  private readonly challengeTTL: number;
  private readonly storage?: RelayAuthManagerOptions["storage"];

  private signer: AuthSigner | null = null;
  private readonly relaySubscriptions = new Map<string, Subscription>();
  private readonly monitoredRelays = new Map<string, AuthRelay>();
  private readonly preferences = new Map<string, AuthPreference>();
  private readonly sessionRejections = new Set<string>();
  private readonly _relayStates = new Map<string, RelayAuthState>();

  private poolAddSub?: Subscription;
  private poolRemoveSub?: Subscription;
  private signerSub?: Subscription;

  /** Observable of all relay auth states. Emits a new Map on every change. */
  readonly states$: BehaviorSubject<ReadonlyMap<string, RelayAuthState>>;

  /** Observable of pending challenges that need user input. */
  readonly pendingChallenges$: BehaviorSubject<PendingAuthChallenge[]>;

  constructor(options: RelayAuthManagerOptions) {
    this.storage = options.storage;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.challengeTTL = options.challengeTTL ?? DEFAULT_CHALLENGE_TTL;

    this.states$ = new BehaviorSubject<ReadonlyMap<string, RelayAuthState>>(
      new Map(),
    );
    this.pendingChallenges$ = new BehaviorSubject<PendingAuthChallenge[]>([]);

    // Load persisted preferences before monitoring relays
    this.loadPreferences();

    // Subscribe to signer changes
    this.signerSub = options.signer$.subscribe((signer) => {
      const hadSigner = this.signer !== null;
      this.signer = signer;

      // When signer becomes available, re-evaluate auto-auth opportunities
      if (signer && !hadSigner) {
        this.reevaluateAutoAuth();
      }

      this.emitState();
    });

    // Subscribe to pool relay lifecycle
    this.poolAddSub = options.pool.add$.subscribe((relay) => {
      this.monitorRelay(relay);
    });

    this.poolRemoveSub = options.pool.remove$.subscribe((relay) => {
      this.unmonitorRelay(relay.url);
    });

    // Monitor initial relays
    if (options.initialRelays) {
      for (const relay of options.initialRelays) {
        this.monitorRelay(relay);
      }
    }
  }

  /**
   * Start monitoring a relay for auth challenges.
   * Safe to call multiple times for the same relay (idempotent).
   */
  monitorRelay(relay: AuthRelay): void {
    const url = relay.url;

    if (this.relaySubscriptions.has(url)) return;

    // Store relay reference for later use (authenticate, auto-auth)
    this.monitoredRelays.set(url, relay);

    // Initialize state
    if (!this._relayStates.has(url)) {
      this._relayStates.set(url, {
        url,
        connected: relay.connected,
        status: "none",
        challenge: relay.challenge,
        challengeReceivedAt: null,
      });
    }

    // Subscribe to relay observables using startWith for initial values
    const sub = combineLatest({
      connected: relay.connected$.pipe(startWith(relay.connected)),
      challenge: relay.challenge$.pipe(startWith(relay.challenge)),
      authenticated: relay.authenticated$.pipe(startWith(relay.authenticated)),
    }).subscribe((values) => {
      this.handleRelayUpdate(url, relay, values);
    });

    this.relaySubscriptions.set(url, sub);
  }

  /**
   * Stop monitoring a relay.
   */
  unmonitorRelay(url: string): void {
    const sub = this.relaySubscriptions.get(url);
    if (sub) {
      sub.unsubscribe();
      this.relaySubscriptions.delete(url);
    }
    this.monitoredRelays.delete(url);
    this._relayStates.delete(url);
    this.emitState();
  }

  /**
   * Authenticate with a relay. Requires a pending challenge and available signer.
   */
  async authenticate(relayUrl: string): Promise<void> {
    const url = this.resolveRelayUrl(relayUrl);
    const state = this._relayStates.get(url);

    const relay = this.monitoredRelays.get(url);
    if (!state || !relay) {
      throw new Error(`Relay ${relayUrl} is not being monitored`);
    }
    if (!state.challenge) {
      throw new Error(`No auth challenge for ${relayUrl}`);
    }
    if (!this.signer) {
      throw new Error("No signer available for authentication");
    }

    // Transition via state machine
    const transition = transitionAuthState(state.status, {
      type: "USER_ACCEPTED",
    });
    state.status = transition.newStatus;
    this.emitState();

    try {
      await relay.authenticate(this.signer);
      // authenticated$ subscription will handle the success state update
    } catch (error) {
      state.status = "failed";
      state.challenge = null;
      state.challengeReceivedAt = null;
      this.emitState();
      throw error;
    }
  }

  /**
   * Reject authentication for a relay.
   * @param relayUrl - Relay URL
   * @param rememberForSession - If true, won't prompt again this session (default: true)
   */
  reject(relayUrl: string, rememberForSession = true): void {
    const url = this.resolveRelayUrl(relayUrl);
    const state = this._relayStates.get(url);

    if (!state) return;

    const transition = transitionAuthState(state.status, {
      type: "USER_REJECTED",
    });
    state.status = transition.newStatus;

    if (transition.clearChallenge) {
      state.challenge = null;
      state.challengeReceivedAt = null;
    }

    if (rememberForSession) {
      this.sessionRejections.add(url);
    }

    this.emitState();
  }

  /**
   * Set auth preference for a relay. Persists to storage if available.
   */
  setPreference(relayUrl: string, preference: AuthPreference): void {
    const url = this.resolveRelayUrl(relayUrl);
    this.preferences.set(url, preference);
    this.savePreferences();
    this.emitState();
  }

  /**
   * Get auth preference for a relay.
   */
  getPreference(relayUrl: string): AuthPreference | undefined {
    const url = this.resolveRelayUrl(relayUrl);
    return this.preferences.get(url);
  }

  /**
   * Get all auth preferences.
   */
  getAllPreferences(): ReadonlyMap<string, AuthPreference> {
    return this.preferences;
  }

  /**
   * Get auth state for a specific relay.
   */
  getRelayState(relayUrl: string): RelayAuthState | undefined {
    const url = this.resolveRelayUrl(relayUrl);
    return this._relayStates.get(url);
  }

  /**
   * Get all relay auth states.
   */
  getAllStates(): ReadonlyMap<string, RelayAuthState> {
    return this._relayStates;
  }

  /**
   * Check if a signer is currently available.
   */
  hasSignerAvailable(): boolean {
    return this.signer !== null;
  }

  /**
   * Clean up all subscriptions and complete observables.
   */
  destroy(): void {
    this.signerSub?.unsubscribe();
    this.poolAddSub?.unsubscribe();
    this.poolRemoveSub?.unsubscribe();

    for (const sub of this.relaySubscriptions.values()) {
      sub.unsubscribe();
    }
    this.relaySubscriptions.clear();
    this.monitoredRelays.clear();
    this._relayStates.clear();

    this.states$.complete();
    this.pendingChallenges$.complete();
  }

  // --- Private ---

  private handleRelayUpdate(
    url: string,
    relay: AuthRelay,
    values: {
      connected: boolean;
      challenge: string | null;
      authenticated: boolean;
    },
  ): void {
    const state = this._relayStates.get(url);
    if (!state) return;

    const wasConnected = state.connected;
    const now = Date.now();

    // Update connection state
    state.connected = values.connected;

    // Determine auth event from observable values
    let authEvent: AuthEvent | null = null;

    // Priority 1: Disconnection
    if (!values.connected && wasConnected) {
      authEvent = { type: "DISCONNECTED" };
    }
    // Priority 2: Authentication success
    else if (values.authenticated && state.status !== "authenticated") {
      authEvent = { type: "AUTH_SUCCESS" };
    }
    // Priority 3: New challenge (or challenge changed)
    else if (values.challenge && values.challenge !== state.challenge) {
      const preference = this.preferences.get(url);
      authEvent = {
        type: "CHALLENGE_RECEIVED",
        challenge: values.challenge,
        preference,
      };
    }
    // Priority 4: Challenge cleared without auth success
    else if (
      !values.challenge &&
      !values.authenticated &&
      (state.status === "authenticating" ||
        state.status === "challenge_received")
    ) {
      authEvent = { type: "AUTH_FAILED" };
    }

    if (authEvent) {
      const transition = transitionAuthState(state.status, authEvent);
      state.status = transition.newStatus;

      // Update challenge
      if (transition.clearChallenge) {
        state.challenge = null;
        state.challengeReceivedAt = null;
      } else if (authEvent.type === "CHALLENGE_RECEIVED") {
        state.challenge = authEvent.challenge;
        state.challengeReceivedAt = now;
      }

      // Handle auto-auth
      if (transition.shouldAutoAuth) {
        if (this.signer) {
          relay.authenticate(this.signer).catch(() => {
            const s = this._relayStates.get(url);
            if (s) {
              s.status = "failed";
              this.emitState();
            }
          });
        } else {
          // No signer available - fall back to challenge_received so it shows as pending
          state.status = "challenge_received";
        }
      }
    }

    this.emitState();
  }

  /**
   * Re-evaluate auto-auth opportunities when signer becomes available.
   * Checks all relays in challenge_received state with "always" preference.
   */
  private reevaluateAutoAuth(): void {
    if (!this.signer) return;

    for (const [url, state] of this._relayStates) {
      if (state.status === "challenge_received" && state.challenge) {
        const pref = this.preferences.get(url);
        if (pref === "always") {
          const relay = this.monitoredRelays.get(url);
          if (!relay) continue;
          state.status = "authenticating";
          relay.authenticate(this.signer!).catch(() => {
            const s = this._relayStates.get(url);
            if (s) {
              s.status = "failed";
              this.emitState();
            }
          });
        }
      }
    }
  }

  private shouldPrompt(url: string): boolean {
    const pref = this.preferences.get(url);
    if (pref === "never") return false;
    if (this.sessionRejections.has(url)) return false;
    return true;
  }

  private isChallengeExpired(receivedAt: number, now = Date.now()): boolean {
    return now - receivedAt > this.challengeTTL;
  }

  private resolveRelayUrl(url: string): string {
    // Fast path: exact match
    if (this._relayStates.has(url)) return url;

    // Try normalized form
    const normalized = normalizeUrl(url);
    if (this._relayStates.has(normalized)) return normalized;

    return url;
  }

  private loadPreferences(): void {
    if (!this.storage) return;

    try {
      const json = this.storage.getItem(this.storageKey);
      if (json) {
        const prefs = JSON.parse(json) as Record<string, AuthPreference>;
        for (const [url, pref] of Object.entries(prefs)) {
          if (pref === "always" || pref === "never" || pref === "ask") {
            this.preferences.set(url, pref);
          }
        }
      }
    } catch {
      // Ignore storage errors silently
    }
  }

  private savePreferences(): void {
    if (!this.storage) return;

    try {
      const prefs: Record<string, AuthPreference> = {};
      for (const [url, pref] of this.preferences) {
        prefs[url] = pref;
      }
      this.storage.setItem(this.storageKey, JSON.stringify(prefs));
    } catch {
      // Ignore storage errors silently
    }
  }

  private emitState(): void {
    // Emit a snapshot of current states
    this.states$.next(new Map(this._relayStates));

    // Derive and emit pending challenges
    const now = Date.now();
    const challenges: PendingAuthChallenge[] = [];

    for (const state of this._relayStates.values()) {
      if (
        state.status === "challenge_received" &&
        state.challenge &&
        state.challengeReceivedAt &&
        !this.isChallengeExpired(state.challengeReceivedAt, now) &&
        this.shouldPrompt(state.url) &&
        this.signer !== null
      ) {
        challenges.push({
          relayUrl: state.url,
          challenge: state.challenge,
          receivedAt: state.challengeReceivedAt,
        });
      }
    }

    this.pendingChallenges$.next(challenges);
  }
}

/**
 * Basic URL normalization for relay URLs.
 */
function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!u.startsWith("ws://") && !u.startsWith("wss://")) {
    u = `wss://${u}`;
  }
  return u.replace(/\/+$/, "");
}
