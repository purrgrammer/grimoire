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

import {
  isHostCapability,
  REMOTE_MEDIA_CAPABILITY,
} from "./napplet-capabilities";

/** The key `adaptHooks`' built-in ACL persistence reads and writes. */
const ACL_STORAGE_KEY = "napplet:acl";

/** Our own record of what the user chose to remember. The real source of truth. */
const DECISIONS_STORAGE_KEY = "napplet:decisions";

const FIREWALL_STORAGE_KEY = "napplet:firewall";

/** Versions whose unenforceable-domain notice the user has already seen. */
const ACKNOWLEDGED_STORAGE_KEY = "napplet:acknowledged";

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

/**
 * Whether this version's unenforceable domains have already been explained.
 *
 * `link`, `common` and `lists` carry no capability, so there is nothing to
 * grant or withhold and nothing to remember as a decision — which meant the
 * launch dialog had no reason to stop appearing, and reappeared on every
 * single run to say the same sentence. It is a notice, not a question, so it
 * is acknowledged once per version instead.
 */
export function hasAcknowledgedUnenforceable(
  dTag: string,
  aggregateHash: string,
): boolean {
  try {
    const raw = localStorage.getItem(ACKNOWLEDGED_STORAGE_KEY);
    if (!raw) return false;
    const seen = JSON.parse(raw) as string[];
    return Array.isArray(seen) && seen.includes(`${dTag}:${aggregateHash}`);
  } catch {
    return false;
  }
}

export function acknowledgeUnenforceable(
  dTag: string,
  aggregateHash: string,
): void {
  try {
    const raw = localStorage.getItem(ACKNOWLEDGED_STORAGE_KEY);
    const seen = raw ? (JSON.parse(raw) as string[]) : [];
    const key = `${dTag}:${aggregateHash}`;
    if (Array.isArray(seen) && !seen.includes(key)) {
      localStorage.setItem(
        ACKNOWLEDGED_STORAGE_KEY,
        JSON.stringify([...seen, key]),
      );
    }
  } catch {
    // Failing to remember only costs the notice being shown again.
  }
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

/**
 * Anything showing remembered decisions needs to know when they change, or it
 * snapshots at mount and silently goes stale.
 */
const decisionListeners = new Set<() => void>();

/** Rebuilt when the stored text changes — see `getNappletDecisions`. */
let decisionsSnapshot: NappletDecision[] = [];
let decisionsSnapshotRaw: string | null = null;

export function subscribeNappletDecisions(listener: () => void): () => void {
  decisionListeners.add(listener);
  return () => decisionListeners.delete(listener);
}

function writeDecisions(decisions: DecisionMap): void {
  try {
    localStorage.setItem(DECISIONS_STORAGE_KEY, JSON.stringify(decisions));
  } catch {
    // Failing to remember is safe: the user is asked again.
  }
  decisionListeners.forEach((listener) => listener());
}

/** Every remembered decision, for the permissions UI. */
/**
 * Every remembered decision.
 *
 * The array is cached because `useSyncExternalStore` requires a stable snapshot —
 * a fresh array on every call re-renders forever. Keyed on the stored text rather
 * than invalidated on write, so a change that did not go through `writeDecisions`
 * (another tab, a test, `resetKehtoAclStore`) is still picked up.
 */
export function getNappletDecisions(): NappletDecision[] {
  let raw: string;
  try {
    raw = localStorage.getItem(DECISIONS_STORAGE_KEY) ?? "";
  } catch {
    return decisionsSnapshot;
  }
  if (raw !== decisionsSnapshotRaw) {
    decisionsSnapshotRaw = raw;
    decisionsSnapshot = Object.values(readDecisions());
  }
  return decisionsSnapshot;
}

/**
 * Whether this napplet version may load remote images, video and fonts.
 *
 * Read at frame creation to build the CSP, so a change only takes effect on the
 * napplet's next run — the policy is baked into `srcdoc`.
 */
export function isRemoteMediaGranted(
  dTag: string,
  aggregateHash: string,
): boolean {
  return (
    readDecisions()[decisionKey(dTag, aggregateHash, REMOTE_MEDIA_CAPABILITY)]
      ?.allowed === true
  );
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
    if (isHostCapability(decision.capability)) continue;
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

/**
 * How many operations a napplet may issue in its first `windowMs`.
 *
 * Kehto's default is 20 in 3s, which is mis-tuned for anything that renders
 * media: a profile or feed napplet legitimately asks for a dozen avatars plus
 * post images the moment it boots, trips the guard, and shows broken images with
 * `firewall: napplet <x> exceeded init-burst limit` as the only trace. 200 still
 * catches the runaway case — a napplet retrying a failing fetch in a loop —
 * which is what the guard is actually for.
 */
const INIT_BURST_MAX_OPS = 200;

/**
 * Widen the init-burst allowance.
 *
 * `burstGuard` is the one part of `FirewallConfig` with no container setter and
 * no entry in `RuntimeConfigOverrides`, and `adaptHooks` supplies no
 * `firewallPersistence`, so `load()` — the only path that would replace the
 * whole config — is a no-op. That leaves mutating the live object `getConfig()`
 * hands back. It survives the setters because each one shallow-spreads the
 * config and so keeps the same `burstGuard` reference.
 *
 * Reaching into a library's state deserves a check that it worked, so the result
 * is read back: on a future version that freezes the config this warns instead of
 * silently leaving image-heavy napplets broken. Worth an upstream ask to make
 * `burstGuard` configurable.
 */
export function relaxInitBurst(firewall: FirewallStateContainer): void {
  try {
    const guard = firewall.getConfig().burstGuard as { maxOps: number };
    guard.maxOps = INIT_BURST_MAX_OPS;
    if (firewall.getConfig().burstGuard.maxOps !== INIT_BURST_MAX_OPS) {
      console.warn(
        "[napplet] could not widen the init-burst guard; media-heavy napplets may be throttled at startup",
      );
    }
  } catch {
    console.warn("[napplet] init-burst guard is not writable");
  }
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
    // `policy` is deliberately never replayed. An earlier build wrote
    // setPolicy(dTag, 'deny') for a remembered refusal; the firewall keys on
    // dTag alone and rejects every operation, so those users would otherwise
    // stay permanently bricked for that identifier — across versions and
    // authors — with nothing in the permissions UI able to clear it, and
    // persistFirewall would rewrite the deny every session. Nothing writes
    // policy any more, so dropping it on read is also the migration.
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
