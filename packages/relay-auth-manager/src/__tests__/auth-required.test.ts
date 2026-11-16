import { describe, it, expect, vi, afterEach } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import { RelayAuthManager } from "../relay-auth-manager.js";
import type { AuthRelay, AuthSigner } from "../types.js";

/**
 * A relay can gate reads/publishes by answering `CLOSED auth-required` /
 * `OK false auth-required` instead of (or long after) sending an AUTH frame.
 * These tests cover the manager reacting to that signal (issue #273).
 */

const URL = "wss://relay.example.com";

function createRelay() {
  const connected$ = new BehaviorSubject(true);
  const challenge$ = new BehaviorSubject<string | null>(null);
  const authenticated$ = new BehaviorSubject(false);
  const authRequiredForRead$ = new BehaviorSubject(false);
  const authRequiredForPublish$ = new BehaviorSubject(false);
  const relay: AuthRelay = {
    url: URL,
    connected$,
    challenge$,
    authenticated$,
    authRequiredForRead$,
    authRequiredForPublish$,
    get connected() {
      return connected$.value;
    },
    get challenge() {
      return challenge$.value;
    },
    get authenticated() {
      return authenticated$.value;
    },
    authenticate: vi.fn().mockImplementation(() => {
      authenticated$.next(true);
      return Promise.resolve({ ok: true });
    }),
  };
  return {
    relay,
    connected$,
    challenge$,
    authenticated$,
    authRequiredForRead$,
    authRequiredForPublish$,
  };
}

function createManager(relay: AuthRelay, signer: AuthSigner | null = null) {
  const store: Record<string, string> = {};
  return new RelayAuthManager({
    pool: { relay: () => relay, add$: new Subject(), remove$: new Subject() },
    signer$: new BehaviorSubject<AuthSigner | null>(signer),
    storage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = value;
      },
    },
    initialRelays: [relay],
  });
}

const signer: AuthSigner = { signEvent: (event) => event };

describe("RelayAuthManager: auth-required without a fresh challenge", () => {
  let manager: RelayAuthManager | undefined;
  afterEach(() => manager?.destroy());

  it("flags a relay that refused a REQ and sent no challenge", () => {
    const r = createRelay();
    manager = createManager(r.relay, signer);

    r.authRequiredForRead$.next(true);

    const state = manager.getRelayState(URL)!;
    expect(state.authRequired).toBe(true);
    expect(state.challenge).toBeNull();
    // Nothing to sign, so nothing to prompt for.
    expect(manager.pendingChallenges$.value).toEqual([]);
  });

  it("flags a relay that refused a publish", () => {
    const r = createRelay();
    manager = createManager(r.relay, signer);

    r.authRequiredForPublish$.next(true);

    expect(manager.getRelayState(URL)!.authRequired).toBe(true);
  });

  it("does not flag an authenticated relay (applesauce keeps the flag set)", () => {
    const r = createRelay();
    r.authenticated$.next(true);
    manager = createManager(r.relay, signer);

    r.authRequiredForRead$.next(true);

    expect(manager.getRelayState(URL)!.authRequired).toBe(false);
  });

  it("prompts for a challenge the relay sent before it was monitored", () => {
    const r = createRelay();
    r.challenge$.next("early");
    manager = createManager(r.relay, signer);
    // Same challenge as at monitor time: no prompt yet.
    expect(manager.pendingChallenges$.value).toEqual([]);

    r.authRequiredForRead$.next(true);

    expect(manager.getRelayState(URL)!.status).toBe("challenge_received");
    expect(manager.pendingChallenges$.value).toEqual([
      expect.objectContaining({ relayUrl: URL, challenge: "early" }),
    ]);
  });

  it("re-surfaces an expired prompt when auth is actually needed", () => {
    vi.useFakeTimers();
    try {
      const r = createRelay();
      manager = createManager(r.relay, signer);
      r.challenge$.next("c1");
      expect(manager.pendingChallenges$.value).toHaveLength(1);

      // Past the 5 minute challenge TTL: the prompt drops out.
      vi.advanceTimersByTime(6 * 60 * 1000);
      r.connected$.next(true);
      expect(manager.pendingChallenges$.value).toEqual([]);

      r.authRequiredForRead$.next(true);
      expect(manager.pendingChallenges$.value).toEqual([
        expect.objectContaining({ relayUrl: URL, challenge: "c1" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-authenticates on auth-required for an 'always' relay", () => {
    const r = createRelay();
    r.challenge$.next("c1");
    manager = createManager(r.relay, signer);
    manager.setPreference(URL, "always");

    r.authRequiredForRead$.next(true);

    expect(r.relay.authenticate).toHaveBeenCalledWith(signer);
    expect(manager.getRelayState(URL)!.status).toBe("authenticated");
    expect(manager.getRelayState(URL)!.authRequired).toBe(false);
  });

  it("does not prompt a relay the user set to 'never'", () => {
    const r = createRelay();
    r.challenge$.next("c1");
    manager = createManager(r.relay, signer);
    manager.setPreference(URL, "never");

    r.authRequiredForRead$.next(true);

    expect(manager.pendingChallenges$.value).toEqual([]);
    expect(r.relay.authenticate).not.toHaveBeenCalled();
  });

  it("does not re-prompt after a dismissal this session", () => {
    const r = createRelay();
    manager = createManager(r.relay, signer);
    r.challenge$.next("c1");
    manager.reject(URL, true);

    r.authRequiredForRead$.next(true);

    expect(manager.pendingChallenges$.value).toEqual([]);
  });

  it("lets an explicit request authenticate after a dismissal", async () => {
    const r = createRelay();
    manager = createManager(r.relay, signer);
    r.challenge$.next("c1");
    manager.reject(URL, true);
    // The manager dropped its copy of the challenge on reject...
    expect(manager.getRelayState(URL)!.status).toBe("rejected");
    expect(manager.getRelayState(URL)!.challenge).toBeNull();

    // ...but the relay still holds it for this socket.
    await manager.authenticate(URL);

    expect(r.relay.authenticate).toHaveBeenCalledWith(signer);
    const state = manager.getRelayState(URL)!;
    expect(state.status).toBe("authenticated");
    expect(state.authRequired).toBe(false);
  });

  it("still refuses to authenticate without any challenge", async () => {
    const r = createRelay();
    manager = createManager(r.relay, signer);
    r.authRequiredForRead$.next(true);

    await expect(manager.authenticate(URL)).rejects.toThrow(
      /No auth challenge/,
    );
  });

  it("accepts relays that do not expose the auth-required signals", () => {
    const r = createRelay();
    const bare: AuthRelay = {
      url: URL,
      connected$: r.connected$,
      challenge$: r.challenge$,
      authenticated$: r.authenticated$,
      connected: true,
      challenge: null,
      authenticated: false,
      authenticate: vi.fn(),
    };
    manager = createManager(bare, signer);

    expect(manager.getRelayState(URL)!.authRequired).toBe(false);
  });
});
