// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetKehtoAclStore,
  isAclRestrictive,
  replayRememberedGrants,
  rememberNappletDecision,
  getNappletDecision,
  getNappletDecisions,
  forgetNappletDecision,
  forgetNappletDecisions,
  persistFirewall,
  restoreFirewall,
} from "./napplet-acl";
import type { AclStateContainer, FirewallStateContainer } from "@kehto/runtime";

const D = "calc";
const H = "a".repeat(64);
const H2 = "b".repeat(64);

/** Minimal stand-in for Kehto's ACL container: records what was granted. */
function fakeAcl(allow: (cap: string) => boolean = () => false) {
  const grants: string[] = [];
  return {
    grants,
    container: {
      check: (_p: string, _d: string, _h: string, capability: string) =>
        allow(capability),
      grant: (_p: string, _d: string, _h: string, capability: string) =>
        grants.push(capability),
    } as unknown as AclStateContainer,
  };
}

function fakeFirewall(config: unknown) {
  const calls: string[] = [];
  return {
    calls,
    container: {
      getConfig: () => config,
      setPolicy: (dTag: string, policy: string) =>
        calls.push(`setPolicy:${dTag}:${policy}`),
      setGlobalRate: (dTag: string) => calls.push(`setGlobalRate:${dTag}`),
      setRateLimit: (dTag: string, opClass: string) =>
        calls.push(`setRateLimit:${dTag}:${opClass}`),
      addMatcher: () => calls.push("addMatcher"),
    } as unknown as FirewallStateContainer,
  };
}

beforeEach(() => {
  localStorage.clear();
});

/* -------------------------------------------------------------------------- */

describe("Kehto ACL store", () => {
  it("is reset to an empty restrictive state", () => {
    localStorage.setItem(
      "napplet:acl",
      JSON.stringify({ defaultPolicy: "permissive", entries: { x: {} } }),
    );
    resetKehtoAclStore();
    expect(JSON.parse(localStorage.getItem("napplet:acl")!)).toEqual({
      defaultPolicy: "restrictive",
      entries: {},
    });
  });

  /**
   * runtime.destroy() persists the whole live state, one-shot grants included,
   * so the previous session's blob must never be trusted.
   */
  it("discards whatever the previous session persisted", () => {
    localStorage.setItem(
      "napplet:acl",
      JSON.stringify({
        defaultPolicy: "restrictive",
        entries: { "calc:hash": { caps: 8192, blocked: false, quota: 1 } },
      }),
    );
    resetKehtoAclStore();
    expect(JSON.parse(localStorage.getItem("napplet:acl")!).entries).toEqual(
      {},
    );
  });

  it("survives an unwritable store rather than throwing", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => resetKehtoAclStore()).not.toThrow();
    setItem.mockRestore();
  });
});

describe("isAclRestrictive", () => {
  /**
   * deserialize() fails open to permissive on any parse error, so a silent
   * fallback would mean every napplet holds every capability.
   */
  it("reports false when the policy failed to take", () => {
    expect(isAclRestrictive(fakeAcl(() => true).container)).toBe(false);
  });

  it("reports true when an ungranted capability is refused", () => {
    expect(isAclRestrictive(fakeAcl(() => false).container)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe("remembered decisions", () => {
  it("round-trips an allow and a deny", () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "theme:read",
      allowed: true,
    });
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "relay:write",
      allowed: false,
    });
    expect(getNappletDecision(D, H, "theme:read")?.allowed).toBe(true);
    expect(getNappletDecision(D, H, "relay:write")?.allowed).toBe(false);
  });

  /** Grants are version-scoped, so an update re-asks rather than inheriting. */
  it("does not leak across aggregate hashes", () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "theme:read",
      allowed: true,
    });
    expect(getNappletDecision(D, H2, "theme:read")).toBeUndefined();
  });

  it("does not leak across napplets", () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "theme:read",
      allowed: true,
    });
    expect(getNappletDecision("other", H, "theme:read")).toBeUndefined();
  });

  it("forgets one capability without touching the rest", () => {
    for (const capability of ["theme:read", "config:read"]) {
      rememberNappletDecision({
        dTag: D,
        aggregateHash: H,
        capability,
        allowed: true,
      });
    }
    forgetNappletDecision(D, H, "theme:read");
    expect(getNappletDecision(D, H, "theme:read")).toBeUndefined();
    expect(getNappletDecision(D, H, "config:read")?.allowed).toBe(true);
  });

  it("forgets a whole version without touching another", () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "theme:read",
      allowed: true,
    });
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H2,
      capability: "theme:read",
      allowed: true,
    });
    forgetNappletDecisions(D, H);
    expect(getNappletDecisions()).toHaveLength(1);
    expect(getNappletDecision(D, H2, "theme:read")?.allowed).toBe(true);
  });

  it("treats a corrupt store as empty rather than throwing", () => {
    localStorage.setItem("napplet:decisions", "{not json");
    expect(getNappletDecisions()).toEqual([]);
  });
});

describe("replayRememberedGrants", () => {
  it("replays allows and never denies", () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "theme:read",
      allowed: true,
    });
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "relay:write",
      allowed: false,
    });
    const acl = fakeAcl();
    replayRememberedGrants(acl.container);
    expect(acl.grants).toEqual(["theme:read"]);
  });

  it("grants nothing on a fresh install", () => {
    const acl = fakeAcl();
    replayRememberedGrants(acl.container);
    expect(acl.grants).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("firewall persistence", () => {
  it("round-trips rate limits and matchers", () => {
    persistFirewall(
      fakeFirewall({
        napplets: { [D]: { rateLimits: { relay: { capacity: 5 } } } },
        matchers: [{ id: "m1", action: "flag" }],
      }).container,
    );
    const restored = fakeFirewall({ napplets: {}, matchers: [] });
    restoreFirewall(restored.container);
    expect(restored.calls).toEqual([`setRateLimit:${D}:relay`, "addMatcher"]);
  });

  /**
   * An earlier build wrote setPolicy(dTag, 'deny') for a remembered refusal.
   * The firewall keys on dTag alone — version- and author-agnostic — and
   * rejects every operation, so replaying one would permanently brick every
   * napplet published under that identifier, with no UI able to clear it.
   */
  it("never replays a policy, so an old deny cannot brick a napplet", () => {
    localStorage.setItem(
      "napplet:firewall",
      JSON.stringify({ napplets: { [D]: { policy: "deny" } }, matchers: [] }),
    );
    const restored = fakeFirewall({ napplets: {}, matchers: [] });
    restoreFirewall(restored.container);
    expect(restored.calls).toEqual([]);
  });

  it("ignores a corrupt snapshot", () => {
    localStorage.setItem("napplet:firewall", "{not json");
    const restored = fakeFirewall({ napplets: {}, matchers: [] });
    expect(() => restoreFirewall(restored.container)).not.toThrow();
    expect(restored.calls).toEqual([]);
  });
});
