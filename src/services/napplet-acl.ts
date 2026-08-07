/**
 * ACL and firewall policy plumbing for the napplet runtime.
 *
 * Two Kehto gaps are worked around here, both without forking the shell layer:
 *
 *  1. `createRuntime` hardcodes `createAclState(persistence, 'permissive')` and
 *     never exposes the policy argument. But it *does* call `aclState.load()`
 *     during init, and `deserialize` honours a persisted
 *     `defaultPolicy: "restrictive"`. So seeding the store before the bridge is
 *     constructed is enough to bring the whole container up restrictive.
 *
 *  2. `adaptHooks` never supplies `firewallPersistence`, so the runtime's
 *     `firewallState.persist()`/`load()` are silent no-ops and every policy
 *     decision — including remembered consent answers — evaporates on reload.
 *     The container's getters and setters *are* reachable via
 *     `bridge.runtime.firewallState`, so we snapshot and replay it ourselves.
 */

import type { AclStateContainer, FirewallStateContainer } from "@kehto/runtime";

/** The key `adaptHooks`' built-in ACL persistence reads and writes. */
const ACL_STORAGE_KEY = "napplet:acl";

/** Our own key — the firewall config Kehto declines to persist. */
const FIREWALL_STORAGE_KEY = "napplet:firewall";

interface SerializedAcl {
  defaultPolicy: "permissive" | "restrictive";
  entries: Record<string, unknown>;
}

/**
 * Ensure the persisted ACL state is restrictive before the runtime loads it.
 *
 * Must run before `createShellBridge`. Under a permissive policy the first
 * `grant()` on a fresh napplet calls `ensureRuntimeDefaultEntry`, which grants
 * `RUNTIME_CAP_ALL` before applying the requested capability — so prompting for
 * one capability would silently hand over every capability. Flipping the
 * default is a precondition for consent, not a hardening extra.
 */
export function seedRestrictiveAcl(): void {
  let existing: SerializedAcl | null = null;
  try {
    const raw = localStorage.getItem(ACL_STORAGE_KEY);
    if (raw) existing = JSON.parse(raw) as SerializedAcl;
  } catch {
    // A corrupt blob is replaced below rather than trusted.
  }

  if (existing?.defaultPolicy === "restrictive" && existing.entries) return;

  const seeded: SerializedAcl = {
    defaultPolicy: "restrictive",
    // Existing grants were made under a permissive default, where the first
    // grant silently widened to every capability. They cannot be trusted, so
    // they are dropped rather than migrated.
    entries: {},
  };
  localStorage.setItem(ACL_STORAGE_KEY, JSON.stringify(seeded));
}

/**
 * Confirm the restrictive policy actually took effect.
 *
 * `deserialize` fails open: any parse failure, and the `catch` inside
 * `aclState.load()`, both fall back to `createState('permissive')`. A silent
 * fallback would mean every napplet gets every capability, so this probes a
 * capability no napplet has been granted and reports whether it was allowed.
 */
export function isAclRestrictive(acl: AclStateContainer): boolean {
  return !acl.check(
    "",
    "__grimoire_acl_probe__",
    "__grimoire_acl_probe__",
    "relay:write",
  );
}

/* -------------------------------------------------------------------------- */
/*  Firewall persistence                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The replayable slice of a `FirewallConfig`.
 *
 * `burstGuard`, `defaultRate` and `unfocusedMultiplier` are global defaults
 * with no setters on the container, so they are neither saved nor restored —
 * we never change them.
 */
interface PersistedFirewall {
  napplets: Record<
    string,
    {
      policy?: "allow" | "deny" | "ask";
      rateLimits?: Record<string, unknown>;
      globalRate?: unknown;
    }
  >;
  matchers: unknown[];
}

/** Snapshot the firewall config to storage. Best-effort; never throws. */
export function persistFirewall(firewall: FirewallStateContainer): void {
  try {
    const config = firewall.getConfig();
    const snapshot: PersistedFirewall = {
      napplets: config.napplets as PersistedFirewall["napplets"],
      matchers: [...config.matchers],
    };
    localStorage.setItem(FIREWALL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Losing firewall state degrades tuning, never safety — the ACL is the gate.
  }
}

/**
 * Replay a persisted firewall config through the container's setters.
 *
 * There is no whole-config setter, so each per-napplet rule and matcher is
 * re-applied individually. Counters are deliberately not restored: a reload
 * should not carry a napplet's spent rate budget with it.
 */
export function restoreFirewall(firewall: FirewallStateContainer): void {
  let snapshot: PersistedFirewall | null = null;
  try {
    const raw = localStorage.getItem(FIREWALL_STORAGE_KEY);
    if (raw) snapshot = JSON.parse(raw) as PersistedFirewall;
  } catch {
    return;
  }
  if (!snapshot?.napplets) return;

  for (const [dTag, rules] of Object.entries(snapshot.napplets)) {
    if (rules.policy) firewall.setPolicy(dTag, rules.policy);
    if (rules.globalRate) {
      firewall.setGlobalRate(
        dTag,
        rules.globalRate as Parameters<typeof firewall.setGlobalRate>[1],
      );
    }
    for (const [opClass, limit] of Object.entries(rules.rateLimits ?? {})) {
      firewall.setRateLimit(
        dTag,
        opClass,
        limit as Parameters<typeof firewall.setRateLimit>[2],
      );
    }
  }
  for (const matcher of snapshot.matchers ?? []) {
    firewall.addMatcher(matcher as Parameters<typeof firewall.addMatcher>[0]);
  }
}
