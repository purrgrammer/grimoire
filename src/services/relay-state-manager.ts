import type { IRelay } from "applesauce-relay";
import { combineLatest, firstValueFrom, race, timer } from "rxjs";
import { filter, map, startWith } from "rxjs/operators";
import type {
  RelayState,
  GlobalRelayState,
  AuthPreference,
} from "@/types/relay-state";
import { transitionAuthState, type AuthEvent } from "@/lib/auth-state-machine";
import { createLogger } from "@/lib/logger";
import { normalizeRelayURL } from "@/lib/relay-url";
import { canAccountSign } from "@/hooks/useAccount";
import pool from "./relay-pool";
import accountManager from "./accounts";
import db from "./db";

const logger = createLogger("RelayStateManager");

const MAX_NOTICES = 20;
const MAX_ERRORS = 20;
const CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Observable values emitted by relay observables
 * Note: Using startWith() to ensure immediate emission with current values
 */
interface RelayObservableValues {
  connected: boolean;
  notices: string[]; // notices is an array of strings
  challenge: string | null | undefined; // challenge can be null or undefined
  authenticated: boolean;
}

/**
 * Singleton service for managing global relay state
 * Subscribes to all relay observables and maintains state for all relays
 */
class RelayStateManager {
  private relayStates: Map<string, RelayState> = new Map();
  private subscriptions: Map<string, () => void> = new Map();
  private listeners: Set<(state: GlobalRelayState) => void> = new Set();
  private authPreferences: Map<string, AuthPreference> = new Map();
  private sessionRejections: Set<string> = new Set();
  private initialized = false;
  private pollingIntervalId?: NodeJS.Timeout;
  private lastNotifiedState?: GlobalRelayState;
  private stateVersion = 0;

  constructor() {
    // Don't perform async operations in constructor
    // They will be handled in initialize()
  }

  /**
   * Initialize relay monitoring for all relays in the pool
   * Must be called before using the manager
   */
  async initialize() {
    if (this.initialized) return;

    // Load preferences from database BEFORE starting monitoring
    // This ensures preferences are available when relays connect
    await this.loadAuthPreferences();

    this.initialized = true;

    // Subscribe to existing relays
    pool.relays.forEach((relay) => {
      this.monitorRelay(relay);
    });

    // Poll for new relays every second and store interval ID for cleanup
    this.pollingIntervalId = setInterval(() => {
      pool.relays.forEach((relay) => {
        if (!this.subscriptions.has(relay.url)) {
          this.monitorRelay(relay);
        }
      });
    }, 1000);
  }

  /**
   * Ensure a relay is being monitored (call this when adding relays to pool)
   * @returns true if relay is being monitored, false if normalization failed
   */
  ensureRelayMonitored(relayUrl: string): boolean {
    try {
      const normalizedUrl = normalizeRelayURL(relayUrl);
      const relay = pool.relay(normalizedUrl);
      if (relay && !this.subscriptions.has(relay.url)) {
        this.monitorRelay(relay);
      }
      return true;
    } catch (error) {
      console.error(`Failed to monitor relay ${relayUrl}:`, error);
      return false;
    }
  }

  /**
   * Subscribe to a single relay's observables
   */
  private monitorRelay(relay: IRelay) {
    const url = relay.url;

    // Initialize state if not exists
    if (!this.relayStates.has(url)) {
      this.relayStates.set(url, this.createInitialState(url));
    }

    // Subscribe to all relay observables using combineLatest
    // startWith ensures immediate emission with current values (critical for BehaviorSubjects)
    // This prevents waiting for all observables to naturally emit
    const subscription = combineLatest({
      connected: relay.connected$.pipe(startWith(relay.connected)),
      notices: relay.notice$.pipe(
        startWith(Array.isArray(relay.notices) ? relay.notices : []),
        map((notice) =>
          Array.isArray(notice) ? notice : notice ? [notice] : [],
        ),
      ),
      challenge: relay.challenge$.pipe(startWith(relay.challenge)),
      authenticated: relay.authenticated$.pipe(startWith(relay.authenticated)),
    }).subscribe((values) => {
      logger.debug(`Observable triggered for ${url}`, {
        authenticated: values.authenticated,
        challenge: values.challenge ? "present" : "none",
      });
      this.updateRelayState(url, values);
    });

    // Store cleanup function
    this.subscriptions.set(url, () => subscription.unsubscribe());
  }

  /**
   * Create initial state for a relay
   */
  private createInitialState(url: string): RelayState {
    return {
      url,
      connectionState: "disconnected",
      authStatus: "none",
      authPreference: this.authPreferences.get(url),
      notices: [],
      errors: [],
      stats: {
        connectionsCount: 0,
        authAttemptsCount: 0,
        authSuccessCount: 0,
      },
    };
  }

  /**
   * Update relay state based on observable values
   * @param url - Relay URL
   * @param values - Current values emitted by relay observables
   */
  private updateRelayState(url: string, values: RelayObservableValues) {
    const state = this.relayStates.get(url);
    if (!state) return;

    const now = Date.now();

    // Update connection state
    const wasConnected = state.connectionState === "connected";
    const isConnected = values.connected;

    if (isConnected && !wasConnected) {
      state.connectionState = "connected";
      state.lastConnected = now;
      state.stats.connectionsCount++;
    } else if (!isConnected && wasConnected) {
      state.connectionState = "disconnected";
      state.lastDisconnected = now;
      // Reset auth status when disconnecting
      console.log(
        `[RelayStateManager] ${url} disconnected, resetting auth status`,
      );
      state.authStatus = "none";
      state.currentChallenge = undefined;
    } else if (isConnected) {
      state.connectionState = "connected";
    } else {
      state.connectionState = "disconnected";
    }

    // Update auth status using state machine
    const challenge = values.challenge;
    const isAuthenticated = values.authenticated;

    // Determine auth events based on observable values
    let authEvent: AuthEvent | null = null;

    // Priority 1: Disconnection (handled above, but check here too)
    if (!isConnected && wasConnected) {
      authEvent = { type: "DISCONNECTED" };
    }
    // Priority 2: Authentication success
    else if (isAuthenticated === true && state.authStatus !== "authenticated") {
      authEvent = { type: "AUTH_SUCCESS" };
    }
    // Priority 3: New challenge (or challenge change)
    else if (
      challenge &&
      (!state.currentChallenge ||
        state.currentChallenge.challenge !== challenge)
    ) {
      const preference = this.authPreferences.get(url);
      authEvent = { type: "CHALLENGE_RECEIVED", challenge, preference };
    }
    // Priority 4: Challenge cleared (authentication may have failed)
    else if (
      !challenge &&
      !isAuthenticated &&
      (state.authStatus === "authenticating" ||
        state.authStatus === "challenge_received")
    ) {
      authEvent = { type: "AUTH_FAILED" };
    }

    // Apply state machine transition if we have an event
    if (authEvent) {
      const transition = transitionAuthState(state.authStatus, authEvent);

      logger.info(
        `${url} auth transition: ${state.authStatus} → ${transition.newStatus}`,
        {
          event: authEvent.type,
        },
      );

      // Update state
      state.authStatus = transition.newStatus;

      // Update challenge
      if (transition.clearChallenge) {
        state.currentChallenge = undefined;
      } else if (authEvent.type === "CHALLENGE_RECEIVED") {
        state.currentChallenge = {
          challenge: authEvent.challenge,
          receivedAt: now,
        };
      }

      // Handle side effects
      if (transition.newStatus === "authenticated") {
        state.lastAuthenticated = now;
        state.stats.authSuccessCount++;
      }

      if (transition.shouldAutoAuth) {
        console.log(
          `[RelayStateManager] ${url} auto-authenticating (preference="always")`,
        );
        // Trigger authentication asynchronously
        this.authenticateRelay(url).catch((error) => {
          console.error(
            `[RelayStateManager] Auto-auth failed for ${url}:`,
            error,
          );
        });
      }
    }

    // Add notices (bounded array)
    if (values.notices && values.notices.length > 0) {
      const notice = values.notices[0];
      const lastNotice = state.notices[0];
      if (!lastNotice || lastNotice.message !== notice) {
        state.notices.unshift({ message: notice, timestamp: now });
        if (state.notices.length > MAX_NOTICES) {
          state.notices = state.notices.slice(0, MAX_NOTICES);
        }
      }
    }

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Get auth preference for a relay
   */
  async getAuthPreference(
    relayUrl: string,
  ): Promise<AuthPreference | undefined> {
    try {
      const normalizedUrl = normalizeRelayURL(relayUrl);

      // Check memory cache first
      if (this.authPreferences.has(normalizedUrl)) {
        return this.authPreferences.get(normalizedUrl);
      }

      // Load from database
      const record = await db.relayAuthPreferences.get(normalizedUrl);
      if (record) {
        this.authPreferences.set(normalizedUrl, record.preference);
        return record.preference;
      }

      return undefined;
    } catch (error) {
      console.error(`Failed to get auth preference for ${relayUrl}:`, error);
      return undefined;
    }
  }

  /**
   * Set auth preference for a relay
   */
  async setAuthPreference(relayUrl: string, preference: AuthPreference) {
    try {
      const normalizedUrl = normalizeRelayURL(relayUrl);
      console.log(
        `[RelayStateManager] Setting auth preference for ${normalizedUrl} to "${preference}"`,
      );

      // Update memory cache
      this.authPreferences.set(normalizedUrl, preference);

      // Save to database
      try {
        await db.relayAuthPreferences.put({
          url: normalizedUrl,
          preference,
          updatedAt: Date.now(),
        });
        console.log(
          `[RelayStateManager] Successfully saved preference to database`,
        );
      } catch (error) {
        console.error(
          `[RelayStateManager] Failed to save preference to database:`,
          error,
        );
        throw error;
      }

      // Update relay state
      const state = this.relayStates.get(normalizedUrl);
      if (state) {
        state.authPreference = preference;
        this.notifyListeners();
        console.log(
          `[RelayStateManager] Updated relay state and notified listeners`,
        );
      }
    } catch (error) {
      console.error(`Failed to set auth preference for ${relayUrl}:`, error);
      throw error;
    }
  }

  /**
   * Authenticate with a relay
   */
  async authenticateRelay(relayUrl: string): Promise<void> {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeRelayURL(relayUrl);
    } catch (error) {
      throw new Error(`Invalid relay URL ${relayUrl}: ${error}`);
    }

    const relay = pool.relay(normalizedUrl);
    const state = this.relayStates.get(relay.url);

    if (!relay || !state) {
      throw new Error(`Relay ${relayUrl} not found`);
    }

    if (!state.currentChallenge) {
      throw new Error(`No auth challenge for ${relayUrl}`);
    }

    // Get active account
    const account = accountManager.active;
    if (!account) {
      throw new Error("No active account to authenticate with");
    }

    // Check if account can sign (read-only accounts cannot authenticate)
    if (!canAccountSign(account)) {
      throw new Error("Active account cannot sign events (read-only account)");
    }

    // Update status to authenticating
    state.authStatus = "authenticating";
    state.stats.authAttemptsCount++;
    this.notifyListeners();

    try {
      logger.info(`Authenticating with ${relayUrl}`);

      // Start authentication
      await relay.authenticate(account);

      // Wait for authenticated$ observable to emit true or timeout after 5 seconds
      // This ensures we get the actual result from the relay, not a race condition
      const authResult = await firstValueFrom(
        race([
          relay.authenticated$.pipe(
            filter((authenticated) => authenticated === true),
            map(() => true),
          ),
          timer(5000).pipe(map(() => false)),
        ]),
      );

      if (!authResult) {
        throw new Error("Authentication timeout - relay did not respond");
      }

      logger.info(`Successfully authenticated with ${relayUrl}`);
      // State will be updated automatically by the combineLatest subscription
    } catch (error) {
      state.authStatus = "failed";

      // Extract error message properly
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Categorize error type
      let errorType: "network" | "authentication" | "protocol" | "unknown" =
        "unknown";
      if (
        errorMessage.includes("timeout") ||
        errorMessage.includes("network")
      ) {
        errorType = "network";
      } else if (
        errorMessage.includes("auth") ||
        errorMessage.includes("sign")
      ) {
        errorType = "authentication";
      } else if (
        errorMessage.includes("protocol") ||
        errorMessage.includes("invalid")
      ) {
        errorType = "protocol";
      }

      state.errors.unshift({
        message: `Authentication failed: ${errorMessage}`,
        timestamp: Date.now(),
        type: errorType,
      });

      if (state.errors.length > MAX_ERRORS) {
        state.errors = state.errors.slice(0, MAX_ERRORS);
      }
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Reject authentication for a relay
   */
  rejectAuth(relayUrl: string, rememberForSession = true) {
    try {
      const normalizedUrl = normalizeRelayURL(relayUrl);
      const state = this.relayStates.get(normalizedUrl);
      if (state) {
        // Use state machine for consistent transitions
        const transition = transitionAuthState(state.authStatus, {
          type: "USER_REJECTED",
        });

        console.log(
          `[RelayStateManager] ${relayUrl} user rejected auth:`,
          `${state.authStatus} → ${transition.newStatus}`,
        );

        state.authStatus = transition.newStatus;
        if (transition.clearChallenge) {
          state.currentChallenge = undefined;
        }

        if (rememberForSession) {
          this.sessionRejections.add(normalizedUrl);
        }
        this.notifyListeners();
      }
    } catch (error) {
      console.error(`Failed to reject auth for ${relayUrl}:`, error);
    }
  }

  /**
   * Check if a relay should be prompted for auth
   */
  shouldPromptAuth(relayUrl: string): boolean {
    try {
      const normalizedUrl = normalizeRelayURL(relayUrl);

      // Don't prompt if there's no active account or account can't sign
      const account = accountManager.active;
      if (!account || !canAccountSign(account)) return false;

      // Check permanent preferences
      const pref = this.authPreferences.get(normalizedUrl);
      if (pref === "never") return false;

      // Check session rejections
      if (this.sessionRejections.has(normalizedUrl)) return false;

      // Don't prompt if already authenticated (unless challenge changes)
      const state = this.relayStates.get(normalizedUrl);
      if (state?.authStatus === "authenticated") return false;

      return true;
    } catch (error) {
      console.error(`Failed to check auth prompt for ${relayUrl}:`, error);
      return false;
    }
  }

  /**
   * Check if a challenge has expired
   */
  private isChallengeExpired(receivedAt: number): boolean {
    return Date.now() - receivedAt > CHALLENGE_TTL;
  }

  /**
   * Get current global state
   */
  getState(): GlobalRelayState {
    const relays: Record<string, RelayState> = {};
    this.relayStates.forEach((state, url) => {
      // Create shallow copy to avoid mutation issues in hasStateChanged
      relays[url] = { ...state };
    });

    const pendingChallenges = Array.from(this.relayStates.values())
      .filter((state) => {
        // Only include non-expired challenges
        if (
          state.authStatus === "challenge_received" &&
          state.currentChallenge &&
          !this.isChallengeExpired(state.currentChallenge.receivedAt) &&
          this.shouldPromptAuth(state.url)
        ) {
          return true;
        }

        // Clear expired challenges
        if (
          state.currentChallenge &&
          this.isChallengeExpired(state.currentChallenge.receivedAt)
        ) {
          console.log(`[RelayStateManager] Challenge expired for ${state.url}`);
          state.currentChallenge = undefined;
          if (state.authStatus === "challenge_received") {
            state.authStatus = "none";
          }
        }

        return false;
      })
      .map((state) => ({
        relayUrl: state.url,
        challenge: state.currentChallenge!.challenge,
        receivedAt: state.currentChallenge!.receivedAt,
      }));

    const authPreferences: Record<string, AuthPreference> = {};
    this.authPreferences.forEach((pref, url) => {
      authPreferences[url] = pref;
    });

    return {
      relays,
      pendingChallenges,
      authPreferences,
    };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: GlobalRelayState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Check if state has actually changed (to avoid unnecessary re-renders)
   */
  private hasStateChanged(newState: GlobalRelayState): boolean {
    if (!this.lastNotifiedState) return true;

    const prev = this.lastNotifiedState;

    // Check if relay count changed
    const prevRelayUrls = Object.keys(prev.relays);
    const newRelayUrls = Object.keys(newState.relays);
    if (prevRelayUrls.length !== newRelayUrls.length) return true;

    // Check if any relay state changed (shallow comparison)
    for (const url of newRelayUrls) {
      const prevRelay = prev.relays[url];
      const newRelay = newState.relays[url];

      // Relay added or removed
      if (!prevRelay || !newRelay) return true;

      // Check important fields for changes
      if (
        prevRelay.connectionState !== newRelay.connectionState ||
        prevRelay.authStatus !== newRelay.authStatus ||
        prevRelay.authPreference !== newRelay.authPreference ||
        prevRelay.currentChallenge?.challenge !==
          newRelay.currentChallenge?.challenge ||
        prevRelay.notices.length !== newRelay.notices.length ||
        prevRelay.errors.length !== newRelay.errors.length
      ) {
        return true;
      }
    }

    // Check pending challenges (length and URLs)
    if (
      prev.pendingChallenges.length !== newState.pendingChallenges.length ||
      prev.pendingChallenges.some(
        (c, i) => c.relayUrl !== newState.pendingChallenges[i]?.relayUrl,
      )
    ) {
      return true;
    }

    // No significant changes detected
    return false;
  }

  /**
   * Notify all listeners of state change (only if state actually changed)
   */
  private notifyListeners() {
    const state = this.getState();

    // Only notify if state has actually changed
    if (this.hasStateChanged(state)) {
      this.stateVersion++;
      this.lastNotifiedState = state;
      this.listeners.forEach((listener) => listener(state));
    }
  }

  /**
   * Load auth preferences from database into memory cache
   */
  private async loadAuthPreferences() {
    try {
      const allPrefs = await db.relayAuthPreferences.toArray();
      allPrefs.forEach((record) => {
        this.authPreferences.set(record.url, record.preference);
      });
      logger.info(`Loaded ${allPrefs.length} auth preferences from database`);
    } catch (error) {
      logger.warn("Failed to load auth preferences", error);
    }
  }

  /**
   * Cleanup all subscriptions and intervals
   */
  destroy() {
    // Clear polling interval
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = undefined;
    }

    // Unsubscribe from all relay observables
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions.clear();

    // Clear all listeners
    this.listeners.clear();
  }
}

// Singleton instance
const relayStateManager = new RelayStateManager();

export default relayStateManager;
