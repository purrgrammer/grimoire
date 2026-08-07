/**
 * ACL policy and durable capability decisions for the napplet runtime.
 *
 * Three Kehto behaviours shape this, none of them optional to work around:
 *
 *  1. `createRuntime` hardcodes `createAclState(persistence, 'permissive')` and
 *     never exposes the policy argument — but it does call `aclState.load()`
 *     during init, and `deserialize` honours a persisted `defaultPolicy`. So
 *     seeding the store before the bridge is built brings the container up
 *     restrictive without forking the shell layer.
 *
 *  2. `aclState.persist()` serializes the *whole* live state, and
 *     `runtime.destroy()` calls it unconditionally. Anything granted for a
 *     single operation would therefore land on disk and outlive the session —
 *     making the "Remember my choice" checkbox decorative on the Allow path.
 *     So Kehto's store is never trusted as the source of truth: we keep our own
 *     record of remembered decisions, wipe Kehto's blob on every boot, and
 *     replay only what the user actually chose to remember.
 *
 *  3. `adaptHooks` never supplies `firewallPersistence`, so the runtime's
 *     firewall `persist()`/`load()` are no-ops. The container's setters are
 *     reachable via `bridge.runtime.firewallState`, so we drive them ourselves.
 */

import type { AclStateContainer, FirewallStateContainer } from "@kehto/runtime";
import type { Capability } from "@kehto/shell";

/** The key `adaptHooks`' built-in ACL persistence reads and writes. */
const ACL_STORAGE_KEY = "napplet:acl";

/** Our own record of what the user chose to remember. The real source of truth. */
const DECISIONS_STORAGE_KEY = "napplet:decisions";

const FIREWALL_STORAGE_KEY = "napplet:firewall";

/** An empty restrictive state — what Kehto's store is always reset to. */
const EMPTY_RESTRICTIVE = JSON.stringify({
  defaultPolicy: "restrictive",
  entries: {},
});

export interface NappletDecision {
  dTag: string;
  aggregateHash: string;
  capability: string;
  allowed: boolean;
}

type DecisionMap = Record<string, NappletDecision>;

export function decisionKey(
  dTag: string,
  aggregateHash: string,
  capability: string,
): string {
  return `${dTag}:${aggregateHash}:${capability}`;
}

function readDecisions(): DecisionMap {
  try {
    const raw = localStorage.getItem(DECISIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DecisionMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeDecisions(decisions: DecisionMap): void {
  try {
    localStorage.setItem(DECISIONS_STORAGE_KEY, JSON.stringify(decisions));
  } catch {
    // Failing to remember is safe: the user is asked again.
  }
}

/** Every remembered decision, for the permissions UI. */
export function getNappletDecisions(): NappletDecision[] {
  return Object.values(readDecisions());
}

/** Look up a remembered decision, if the user made one. */
export function getNappletDecision(
  dTag: string,
  aggregateHash: string,
  capability: string,
): NappletDecision | undefined {
  return readDecisions()[decisionKey(dTag, aggregateHash, capability)];
}

/** Record a remembered allow or deny. */
export function rememberNappletDecision(decision: NappletDecision): void {
  const decisions = readDecisions();
  decisions[
    decisionKey(decision.dTag, decision.aggregateHash, decision.capability)
  ] = decision;
  writeDecisions(decisions);
}

/** Forget one decision. The napplet will be asked again next time. */
export function forgetNappletDecision(
  dTag: string,
  aggregateHash: string,
  capability: string,
): void {
  const decisions = readDecisions();
  delete decisions[decisionKey(dTag, aggregateHash, capability)];
  writeDecisions(decisions);
}

/** Forget every decision for one napplet version. */
export function forgetNappletDecisions(
  dTag: string,
  aggregateHash: string,
): void {
  const decisions = readDecisions();
  for (const [key, decision] of Object.entries(decisions)) {
    if (decision.dTag === dTag && decision.aggregateHash === aggregateHash) {
      delete decisions[key];
    }
  }
  writeDecisions(decisions);
}

/**
 * Reset Kehto's ACL blob to an empty restrictive state.
 *
 * Called before the bridge is built and again after it is destroyed. The
 * runtime persists its whole live state on destroy, which would otherwise turn
 * every one-shot grant into a durable one.
 */
export function resetKehtoAclStore(): void {
  try {
    localStorage.setItem(ACL_STORAGE_KEY, EMPTY_RESTRICTIVE);
  } catch {
    // If this throws the store is unwritable, so nothing can leak to disk.
  }
}

/**
 * Confirm the restrictive policy actually took effect.
 *
 * `deserialize` fails open: any parse failure, and the `catch` inside
 * `aclState.load()`, both fall back to `createState('permissive')`. Probing a
 * capability no real napplet identity can hold turns a silent fallback into a
 * loud one.
 */
export function isAclRestrictive(acl: AclStateContainer): boolean {
  return !acl.check(
    "",
    "__grimoire_acl_probe__",
    "__grimoire_acl_probe__",
    "relay:write",
  );
}

/**
 * Replay remembered allows into the freshly-loaded ACL state.
 *
 * Denials are deliberately not replayed as ACL state: under a restrictive
 * default, "not granted" already means denied. They are consulted by the
 * consent layer purely to avoid re-asking.
 */
export function replayRememberedGrants(acl: AclStateContainer): void {
  for (const decision of getNappletDecisions()) {
    if (!decision.allowed) continue;
    acl.grant(
      "",
      decision.dTag,
      decision.aggregateHash,
      decision.capability as Capability,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Firewall persistence                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The replayable slice of a `FirewallConfig`. `burstGuard`, `defaultRate` and
 * `unfocusedMultiplier` are global defaults with no container setters, so they
 * are neither saved nor restored.
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
    // Losing firewall state degrades rate tuning, never the ACL gate.
  }
}

/**
 * Replay a persisted firewall config through the container's setters. Counters
 * are deliberately not restored — a reload should not carry a napplet's spent
 * rate budget with it.
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
