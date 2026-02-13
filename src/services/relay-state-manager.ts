import type { IRelay } from "applesauce-relay";
import { combineLatest } from "rxjs";
import { map, startWith } from "rxjs/operators";
import type {
  RelayState,
  GlobalRelayState,
  AuthPreference,
} from "@/types/relay-state";
import { normalizeRelayURL } from "@/lib/relay-url";
import pool from "./relay-pool";
import relayAuthManager from "./relay-auth";

const MAX_NOTICES = 20;

/**
 * Observable values emitted by relay observables (connection + notices only)
 */
interface RelayObservableValues {
  connected: boolean;
  notices: string[];
}

/**
 * Singleton service for managing global relay state.
 *
 * Tracks relay connection state, notices, and errors.
 * Delegates all NIP-42 authentication logic to the generic RelayAuthManager.
 */
class RelayStateManager {
  private relayStates: Map<string, RelayState> = new Map();
  private subscriptions: Map<string, () => void> = new Map();
  private listeners: Set<(state: GlobalRelayState) => void> = new Set();
  private initialized = false;
  private pollingIntervalId?: NodeJS.Timeout;
  private lastNotifiedState?: GlobalRelayState;
  private stateVersion = 0;
  private authUnsubscribe?: () => void;

  constructor() {
    // Don't perform async operations in constructor
    // They will be handled in initialize()
  }

  /**
   * Initialize relay monitoring for all relays in the pool
   * Must be called before using the manager
   */
  initialize() {
    if (this.initialized) return;

    this.initialized = true;

    // Subscribe to auth manager state and pending challenge changes
    const stateSub = relayAuthManager.states$.subscribe(() => {
      this.notifyListeners();
    });
    const challengeSub = relayAuthManager.pendingChallenges$.subscribe(() => {
      this.notifyListeners();
    });
    this.authUnsubscribe = () => {
      stateSub.unsubscribe();
      challengeSub.unsubscribe();
    };

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

    // Also monitor in the auth manager
    relayAuthManager.monitorRelay(relay);

    // Subscribe to connection and notice observables only
    const subscription = combineLatest({
      connected: relay.connected$.pipe(startWith(relay.connected)),
      notices: relay.notice$.pipe(
        startWith(Array.isArray(relay.notices) ? relay.notices : []),
        map((notice) =>
          Array.isArray(notice) ? notice : notice ? [notice] : [],
        ),
      ),
    }).subscribe((values) => {
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
      authPreference: relayAuthManager.getPreference(url),
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
   * Update relay state based on observable values (connection + notices only)
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
    } else if (isConnected) {
      state.connectionState = "connected";
    } else {
      state.connectionState = "disconnected";
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
   * Get auth preference for a relay (delegates to auth manager)
   */
  getAuthPreference(relayUrl: string): AuthPreference | undefined {
    return relayAuthManager.getPreference(relayUrl);
  }

  /**
   * Set auth preference for a relay (delegates to auth manager)
   */
  setAuthPreference(relayUrl: string, preference: AuthPreference) {
    relayAuthManager.setPreference(relayUrl, preference);

    // Update local relay state for UI
    try {
      const normalizedUrl = normalizeRelayURL(relayUrl);
      const state = this.relayStates.get(normalizedUrl);
      if (state) {
        state.authPreference = preference;
      }
    } catch {
      // Ignore normalization errors
    }

    this.notifyListeners();
  }

  /**
   * Authenticate with a relay (delegates to auth manager)
   */
  async authenticateRelay(relayUrl: string): Promise<void> {
    await relayAuthManager.authenticate(relayUrl);
  }

  /**
   * Reject authentication for a relay (delegates to auth manager)
   */
  rejectAuth(relayUrl: string, rememberForSession = true) {
    relayAuthManager.reject(relayUrl, rememberForSession);
  }

  /**
   * Get current global state (merges connection state with auth state)
   */
  getState(): GlobalRelayState {
    const relays: Record<string, RelayState> = {};
    const authStates = relayAuthManager.getAllStates();

    this.relayStates.forEach((state, url) => {
      const authState = authStates.get(url);
      relays[url] = {
        ...state,
        // Merge auth state from the auth manager
        authStatus: authState?.status ?? "none",
        authPreference: relayAuthManager.getPreference(url),
        currentChallenge:
          authState?.challenge && authState.challengeReceivedAt
            ? {
                challenge: authState.challenge,
                receivedAt: authState.challengeReceivedAt,
              }
            : undefined,
      };
    });

    // Get pending challenges from auth manager
    const pendingChallenges = relayAuthManager.pendingChallenges$.value;

    const authPreferences: Record<string, AuthPreference> = {};
    for (const [url, pref] of relayAuthManager.getAllPreferences()) {
      authPreferences[url] = pref;
    }

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
   * Cleanup all subscriptions and intervals
   */
  destroy() {
    // Clear polling interval
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = undefined;
    }

    // Unsubscribe from auth manager
    this.authUnsubscribe?.();

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
