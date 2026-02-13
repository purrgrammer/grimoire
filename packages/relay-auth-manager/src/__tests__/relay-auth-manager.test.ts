import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import { RelayAuthManager } from "../relay-auth-manager.js";
import type {
  AuthRelay,
  AuthRelayPool,
  AuthSigner,
  AuthPreferenceStorage,
  RelayAuthManagerOptions,
} from "../types.js";

// --- Test helpers ---

function createMockRelay(url: string): AuthRelay & {
  connected$: BehaviorSubject<boolean>;
  challenge$: BehaviorSubject<string | null>;
  authenticated$: BehaviorSubject<boolean>;
} {
  return {
    url,
    connected: false,
    authenticated: false,
    challenge: null,
    connected$: new BehaviorSubject<boolean>(false),
    challenge$: new BehaviorSubject<string | null>(null),
    authenticated$: new BehaviorSubject<boolean>(false),
    authenticate: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function createMockPool(
  relays: Map<string, ReturnType<typeof createMockRelay>> = new Map(),
): AuthRelayPool & {
  add$: Subject<AuthRelay>;
  remove$: Subject<AuthRelay>;
} {
  const add$ = new Subject<AuthRelay>();
  const remove$ = new Subject<AuthRelay>();

  return {
    relay: (url: string) => {
      let r = relays.get(url);
      if (!r) {
        r = createMockRelay(url);
        relays.set(url, r);
      }
      return r;
    },
    add$,
    remove$,
  };
}

function createMockStorage(): AuthPreferenceStorage & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

function createMockSigner(): AuthSigner {
  return {
    signEvent: vi.fn().mockImplementation((event) => ({
      ...event,
      sig: "mock-sig",
    })),
  };
}

function createManager(overrides: Partial<RelayAuthManagerOptions> = {}): {
  manager: RelayAuthManager;
  pool: ReturnType<typeof createMockPool>;
  signer$: BehaviorSubject<AuthSigner | null>;
  storage: ReturnType<typeof createMockStorage>;
} {
  const pool = createMockPool();
  const signer$ = new BehaviorSubject<AuthSigner | null>(null);
  const storage = createMockStorage();

  const manager = new RelayAuthManager({
    pool,
    signer$,
    storage,
    ...overrides,
  });

  return { manager, pool, signer$, storage };
}

// --- Tests ---

describe("RelayAuthManager", () => {
  let manager: RelayAuthManager;
  let pool: ReturnType<typeof createMockPool>;
  let signer$: BehaviorSubject<AuthSigner | null>;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    const ctx = createManager();
    manager = ctx.manager;
    pool = ctx.pool;
    signer$ = ctx.signer$;
    storage = ctx.storage;
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("relay monitoring", () => {
    it("should monitor relays added to pool via add$", () => {
      const relay = createMockRelay("wss://relay.example.com");
      pool.add$.next(relay);

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state).toBeDefined();
      expect(state!.url).toBe("wss://relay.example.com");
      expect(state!.status).toBe("none");
    });

    it("should monitor initial relays passed in options", () => {
      manager.destroy();

      const relay = createMockRelay("wss://initial.relay.com");
      const ctx = createManager({ initialRelays: [relay] });
      manager = ctx.manager;

      const state = manager.getRelayState("wss://initial.relay.com");
      expect(state).toBeDefined();
      expect(state!.status).toBe("none");
    });

    it("should stop monitoring relays removed from pool", () => {
      const relay = createMockRelay("wss://relay.example.com");
      pool.add$.next(relay);
      expect(manager.getRelayState("wss://relay.example.com")).toBeDefined();

      pool.remove$.next(relay);
      expect(manager.getRelayState("wss://relay.example.com")).toBeUndefined();
    });

    it("should be idempotent for monitorRelay", () => {
      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);
      manager.monitorRelay(relay); // second call should be a no-op

      const states = manager.getAllStates();
      expect(states.size).toBe(1);
    });

    it("should unmonitor relay by URL", () => {
      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);
      manager.unmonitorRelay("wss://relay.example.com");

      expect(manager.getRelayState("wss://relay.example.com")).toBeUndefined();
    });
  });

  describe("challenge detection", () => {
    it("should detect new challenge from relay", () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("challenge_received");
      expect(state!.challenge).toBe("test-challenge");
      expect(state!.challengeReceivedAt).toBeGreaterThan(0);
    });

    it("should detect challenge change", () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("challenge-1");
      expect(manager.getRelayState("wss://relay.example.com")!.challenge).toBe(
        "challenge-1",
      );

      // Simulate user rejected, then new challenge arrives
      manager.reject("wss://relay.example.com", false);
      relay.challenge$.next("challenge-2");

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.challenge).toBe("challenge-2");
      expect(state!.status).toBe("challenge_received");
    });

    it("should reset auth state on disconnect", () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");
      expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
        "challenge_received",
      );

      relay.connected$.next(false);
      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("none");
      expect(state!.challenge).toBeNull();
    });
  });

  describe("pending challenges observable", () => {
    it("should emit pending challenges when signer is available", () => {
      const challenges: Array<{ relayUrl: string }[]> = [];
      manager.pendingChallenges$.subscribe((c) => challenges.push(c));

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      // No signer - challenge should not be pending
      relay.challenge$.next("test-challenge");
      const withoutSigner = challenges[challenges.length - 1];
      expect(withoutSigner).toHaveLength(0);

      // Signer available - challenge should be pending
      signer$.next(createMockSigner());
      const withSigner = challenges[challenges.length - 1];
      expect(withSigner).toHaveLength(1);
      expect(withSigner[0].relayUrl).toBe("wss://relay.example.com");
    });

    it("should not include challenges for relays with 'never' preference", () => {
      signer$.next(createMockSigner());
      manager.setPreference("wss://relay.example.com", "never");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      const state = manager.getRelayState("wss://relay.example.com");
      // Status is "rejected" because "never" preference auto-rejects
      expect(state!.status).toBe("rejected");

      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(0);
    });

    it("should not include challenges for session-rejected relays", () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");
      manager.reject("wss://relay.example.com", true); // remember for session

      // New challenge arrives
      relay.challenge$.next("new-challenge");

      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(0);
    });

    it("should not include expired challenges", () => {
      manager.destroy();

      // Create manager with very short TTL
      const ctx = createManager({ challengeTTL: 1 }); // 1ms TTL
      manager = ctx.manager;
      pool = ctx.pool;
      signer$ = ctx.signer$;

      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      // Wait for TTL to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Force re-emission by triggering signer update
          signer$.next(createMockSigner());

          let pending: { relayUrl: string }[] = [];
          manager.pendingChallenges$.subscribe((c) => (pending = c));
          expect(pending).toHaveLength(0);
          resolve();
        }, 10);
      });
    });
  });

  describe("authentication", () => {
    it("should authenticate with relay when signer is available", async () => {
      const signer = createMockSigner();
      signer$.next(signer);

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      await manager.authenticate("wss://relay.example.com");

      expect(relay.authenticate).toHaveBeenCalledWith(signer);
    });

    it("should transition to authenticating status during auth", async () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      // Start auth (don't await yet)
      const authPromise = manager.authenticate("wss://relay.example.com");

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("authenticating");

      await authPromise;
    });

    it("should throw if no relay is being monitored", async () => {
      signer$.next(createMockSigner());

      await expect(
        manager.authenticate("wss://unknown.relay.com"),
      ).rejects.toThrow("not being monitored");
    });

    it("should throw if no challenge exists", async () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      await expect(
        manager.authenticate("wss://relay.example.com"),
      ).rejects.toThrow("No auth challenge");
    });

    it("should throw if no signer is available", async () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      await expect(
        manager.authenticate("wss://relay.example.com"),
      ).rejects.toThrow("No signer available");
    });

    it("should set status to failed on auth error", async () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      (relay.authenticate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("auth failed"),
      );
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      await expect(
        manager.authenticate("wss://relay.example.com"),
      ).rejects.toThrow("auth failed");

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("failed");
    });

    it("should update to authenticated when authenticated$ emits true", () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      // Simulate authentication success via observable
      relay.authenticated$.next(true);

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("authenticated");
    });
  });

  describe("rejection", () => {
    it("should reject auth and update status", () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      manager.reject("wss://relay.example.com");

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("rejected");
      expect(state!.challenge).toBeNull();
    });

    it("should remember session rejection", () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      manager.reject("wss://relay.example.com", true);

      // New challenge arrives
      relay.challenge$.next("new-challenge");

      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(0);
    });

    it("should not remember session rejection when flag is false", () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("challenge-1");

      manager.reject("wss://relay.example.com", false);

      // New challenge arrives
      relay.challenge$.next("challenge-2");

      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(1);
    });

    it("should be a no-op for unknown relay", () => {
      // Should not throw
      manager.reject("wss://unknown.relay.com");
    });
  });

  describe("auto-auth (always preference)", () => {
    it("should auto-authenticate when preference is always and signer is available", () => {
      const signer = createMockSigner();
      signer$.next(signer);
      manager.setPreference("wss://relay.example.com", "always");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      // Should have called authenticate
      expect(relay.authenticate).toHaveBeenCalledWith(signer);

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("authenticating");
    });

    it("should NOT auto-authenticate when preference is always but no signer", () => {
      // No signer
      manager.setPreference("wss://relay.example.com", "always");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      // Should NOT have called authenticate
      expect(relay.authenticate).not.toHaveBeenCalled();

      // Should fall back to challenge_received
      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("challenge_received");
    });

    it("should auto-authenticate when signer becomes available after challenge", () => {
      manager.setPreference("wss://relay.example.com", "always");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      // No signer yet, should be in challenge_received
      expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
        "challenge_received",
      );

      // Now provide signer
      const signer = createMockSigner();
      signer$.next(signer);

      // Should have auto-authenticated
      expect(relay.authenticate).toHaveBeenCalledWith(signer);
    });
  });

  describe("auto-reject (never preference)", () => {
    it("should auto-reject when preference is never", () => {
      signer$.next(createMockSigner());
      manager.setPreference("wss://relay.example.com", "never");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state!.status).toBe("rejected");
      expect(relay.authenticate).not.toHaveBeenCalled();
    });
  });

  describe("preferences", () => {
    it("should set and get preference", () => {
      manager.setPreference("wss://relay.example.com", "always");
      expect(manager.getPreference("wss://relay.example.com")).toBe("always");
    });

    it("should persist preferences to storage", () => {
      manager.setPreference("wss://relay.example.com", "always");
      manager.setPreference("wss://other.relay.com", "never");

      const saved = JSON.parse(storage.store["relay-auth-preferences"] || "{}");
      expect(saved["wss://relay.example.com"]).toBe("always");
      expect(saved["wss://other.relay.com"]).toBe("never");
    });

    it("should load preferences from storage on initialization", () => {
      manager.destroy();

      const newStorage = createMockStorage();
      newStorage.store["relay-auth-preferences"] = JSON.stringify({
        "wss://relay.example.com": "always",
        "wss://other.relay.com": "never",
      });

      const ctx = createManager({ storage: newStorage });
      manager = ctx.manager;

      expect(manager.getPreference("wss://relay.example.com")).toBe("always");
      expect(manager.getPreference("wss://other.relay.com")).toBe("never");
    });

    it("should use custom storage key", () => {
      manager.destroy();

      const ctx = createManager({ storageKey: "my-auth-prefs" });
      manager = ctx.manager;
      storage = ctx.storage;

      manager.setPreference("wss://relay.example.com", "always");

      expect(storage.store["my-auth-prefs"]).toBeDefined();
      const saved = JSON.parse(storage.store["my-auth-prefs"]);
      expect(saved["wss://relay.example.com"]).toBe("always");
    });

    it("should return all preferences", () => {
      manager.setPreference("wss://a.relay.com", "always");
      manager.setPreference("wss://b.relay.com", "never");

      const all = manager.getAllPreferences();
      expect(all.size).toBe(2);
      expect(all.get("wss://a.relay.com")).toBe("always");
      expect(all.get("wss://b.relay.com")).toBe("never");
    });

    it("should handle corrupted storage gracefully", () => {
      manager.destroy();

      const newStorage = createMockStorage();
      newStorage.store["relay-auth-preferences"] = "not valid json";

      // Should not throw
      const ctx = createManager({ storage: newStorage });
      manager = ctx.manager;

      expect(manager.getPreference("wss://relay.example.com")).toBeUndefined();
    });

    it("should ignore invalid preference values from storage", () => {
      manager.destroy();

      const newStorage = createMockStorage();
      newStorage.store["relay-auth-preferences"] = JSON.stringify({
        "wss://relay.example.com": "invalid_value",
        "wss://other.relay.com": "always",
      });

      const ctx = createManager({ storage: newStorage });
      manager = ctx.manager;

      expect(manager.getPreference("wss://relay.example.com")).toBeUndefined();
      expect(manager.getPreference("wss://other.relay.com")).toBe("always");
    });

    it("should work without storage", () => {
      manager.destroy();

      const ctx = createManager({ storage: undefined });
      manager = ctx.manager;

      // Should not throw
      manager.setPreference("wss://relay.example.com", "always");
      expect(manager.getPreference("wss://relay.example.com")).toBe("always");
    });
  });

  describe("signer lifecycle", () => {
    it("should not show pending challenges when no signer", () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(0);
    });

    it("should show pending challenges when signer becomes available", () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(0);

      signer$.next(createMockSigner());
      expect(pending).toHaveLength(1);
    });

    it("should hide pending challenges when signer is removed", () => {
      signer$.next(createMockSigner());

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(1);

      signer$.next(null);
      expect(pending).toHaveLength(0);
    });

    it("should report signer availability", () => {
      expect(manager.hasSignerAvailable()).toBe(false);
      signer$.next(createMockSigner());
      expect(manager.hasSignerAvailable()).toBe(true);
      signer$.next(null);
      expect(manager.hasSignerAvailable()).toBe(false);
    });
  });

  describe("states$ observable", () => {
    it("should emit initial empty state", () => {
      let latest: ReadonlyMap<string, unknown> | undefined;
      manager.states$.subscribe((s) => (latest = s));

      expect(latest).toBeDefined();
      expect(latest!.size).toBe(0);
    });

    it("should emit updated state when relay is added", () => {
      let latest: ReadonlyMap<string, unknown> | undefined;
      manager.states$.subscribe((s) => (latest = s));

      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);

      expect(latest!.size).toBe(1);
    });

    it("should emit updated state on status change", () => {
      const states: Array<ReadonlyMap<string, { status: string }>> = [];
      manager.states$.subscribe((s) => states.push(s));

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      const last = states[states.length - 1];
      expect(last.get("wss://relay.example.com")?.status).toBe(
        "challenge_received",
      );
    });

    it("should emit immutable snapshots (not the same reference)", () => {
      const snapshots: Array<ReadonlyMap<string, unknown>> = [];
      manager.states$.subscribe((s) => snapshots.push(s));

      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      // Each emission should be a different Map instance
      if (snapshots.length >= 2) {
        expect(snapshots[snapshots.length - 1]).not.toBe(
          snapshots[snapshots.length - 2],
        );
      }
    });
  });

  describe("connection state tracking", () => {
    it("should track relay connection state", () => {
      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);

      expect(manager.getRelayState("wss://relay.example.com")!.connected).toBe(
        false,
      );

      relay.connected$.next(true);
      expect(manager.getRelayState("wss://relay.example.com")!.connected).toBe(
        true,
      );

      relay.connected$.next(false);
      expect(manager.getRelayState("wss://relay.example.com")!.connected).toBe(
        false,
      );
    });
  });

  describe("multiple relays", () => {
    it("should handle multiple relays independently", () => {
      signer$.next(createMockSigner());

      const relay1 = createMockRelay("wss://relay1.example.com");
      const relay2 = createMockRelay("wss://relay2.example.com");

      relay1.connected$.next(true);
      relay2.connected$.next(true);

      manager.monitorRelay(relay1);
      manager.monitorRelay(relay2);

      relay1.challenge$.next("challenge-1");
      relay2.challenge$.next("challenge-2");

      expect(manager.getRelayState("wss://relay1.example.com")!.challenge).toBe(
        "challenge-1",
      );
      expect(manager.getRelayState("wss://relay2.example.com")!.challenge).toBe(
        "challenge-2",
      );

      // Authenticate only relay1
      manager.authenticate("wss://relay1.example.com");

      expect(manager.getRelayState("wss://relay1.example.com")!.status).toBe(
        "authenticating",
      );
      expect(manager.getRelayState("wss://relay2.example.com")!.status).toBe(
        "challenge_received",
      );
    });

    it("should track different preferences per relay", () => {
      manager.setPreference("wss://relay1.example.com", "always");
      manager.setPreference("wss://relay2.example.com", "never");

      expect(manager.getPreference("wss://relay1.example.com")).toBe("always");
      expect(manager.getPreference("wss://relay2.example.com")).toBe("never");
    });
  });

  describe("URL resolution", () => {
    it("should resolve relay URL when state exists", () => {
      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);

      const state = manager.getRelayState("wss://relay.example.com");
      expect(state).toBeDefined();
    });

    it("should try normalized URL", () => {
      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);

      // Try with trailing slash
      const state = manager.getRelayState("wss://relay.example.com/");
      // normalizeUrl strips trailing slash, should find it
      expect(state).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clean up all subscriptions", () => {
      const relay = createMockRelay("wss://relay.example.com");
      manager.monitorRelay(relay);

      manager.destroy();

      expect(manager.getAllStates().size).toBe(0);
    });

    it("should complete observables", () => {
      let statesCompleted = false;
      let challengesCompleted = false;

      manager.states$.subscribe({
        complete: () => (statesCompleted = true),
      });
      manager.pendingChallenges$.subscribe({
        complete: () => (challengesCompleted = true),
      });

      manager.destroy();

      expect(statesCompleted).toBe(true);
      expect(challengesCompleted).toBe(true);
    });
  });

  describe("integration: full auth flow", () => {
    it("should handle complete auth lifecycle", async () => {
      const signer = createMockSigner();
      signer$.next(signer);

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      // 1. Challenge received
      relay.challenge$.next("auth-challenge");
      expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
        "challenge_received",
      );

      // 2. User authenticates
      await manager.authenticate("wss://relay.example.com");
      expect(relay.authenticate).toHaveBeenCalledWith(signer);

      // 3. Relay confirms authentication
      relay.authenticated$.next(true);
      expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
        "authenticated",
      );

      // 4. Relay disconnects
      relay.connected$.next(false);
      expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
        "none",
      );
    });

    it("should handle auto-auth flow", () => {
      const signer = createMockSigner();
      signer$.next(signer);
      manager.setPreference("wss://relay.example.com", "always");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      // Challenge received → auto-auth
      relay.challenge$.next("auth-challenge");

      expect(relay.authenticate).toHaveBeenCalledWith(signer);
      expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
        "authenticating",
      );
    });

    it("should handle auto-reject flow", () => {
      signer$.next(createMockSigner());
      manager.setPreference("wss://relay.example.com", "never");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);

      relay.challenge$.next("auth-challenge");

      expect(relay.authenticate).not.toHaveBeenCalled();
      expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
        "rejected",
      );
    });

    it("should handle signer swap during pending challenge", () => {
      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      manager.monitorRelay(relay);
      relay.challenge$.next("test-challenge");

      // No signer - challenge pending but not shown
      let pending: { relayUrl: string }[] = [];
      manager.pendingChallenges$.subscribe((c) => (pending = c));
      expect(pending).toHaveLength(0);

      // First signer
      const signer1 = createMockSigner();
      signer$.next(signer1);
      expect(pending).toHaveLength(1);

      // Switch to null (logged out)
      signer$.next(null);
      expect(pending).toHaveLength(0);

      // Second signer (re-login)
      const signer2 = createMockSigner();
      signer$.next(signer2);
      expect(pending).toHaveLength(1);
    });

    it("should handle auto-auth failure gracefully", async () => {
      const signer = createMockSigner();
      signer$.next(signer);
      manager.setPreference("wss://relay.example.com", "always");

      const relay = createMockRelay("wss://relay.example.com");
      relay.connected$.next(true);
      (relay.authenticate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("signing failed"),
      );
      manager.monitorRelay(relay);

      relay.challenge$.next("test-challenge");

      // Wait for the async failure to propagate
      await vi.waitFor(() => {
        expect(manager.getRelayState("wss://relay.example.com")!.status).toBe(
          "failed",
        );
      });
    });
  });
});
