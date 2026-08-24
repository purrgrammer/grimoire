/**
 * The bridge between what a manifest declares and what the ACL grants.
 *
 * NIP-5D `requires` tags name bare NAP **domains** (`relay`, `theme`), while
 * Kehto's ACL is keyed on **capabilities** (`relay:write`, `theme:read`). Every
 * host has to pick the mapping, and the choice has teeth — see the `inc` note
 * below.
 *
 * This module imports nothing so both the host and the consent layer can use it
 * without a cycle.
 */

/**
 * Capabilities each domain needs to function.
 *
 * `inc` is the sharp one: `incMap()` in `@kehto/acl` resolves `inc.emit` to
 * `relay:write` and the rest of `inc.*` to `relay:read` — there are no
 * `inc:*` capabilities. So a napplet declaring only `inc` must be granted the
 * same bits that authorize `relay.publish`. The capability grant alone would be
 * a privilege escalation; what stops it is `narrowEnvironment` below, which
 * removes `relay` from the napplet's advertised domains entirely when it wasn't
 * declared. Both halves are required — neither is sufficient alone.
 *
 * `link`, `common` and `lists` map to nothing because Kehto defines no
 * capability for them; they are gated by per-operation confirmation instead.
 */
const DOMAIN_CAPABILITIES: Record<string, readonly string[]> = {
  theme: ["theme:read"],
  config: ["config:read"],
  identity: ["identity:read"],
  storage: ["state:read", "state:write"],
  inc: ["relay:read", "relay:write"],
  relay: ["relay:read", "relay:write"],
  outbox: ["outbox:read", "outbox:write"],
  upload: ["upload:write"],
  notify: ["notify:send", "notify:channel"],
  media: ["media:control"],
  keys: ["keys:forward", "keys:bind"],
  resource: ["resource:fetch"],
  intent: ["intent:read", "intent:write"],
  dm: ["dm:read", "dm:write"],
  cvm: ["cvm:call"],
  count: ["relay:read"],
  link: [],
  common: [],
  lists: [],
};

/* -------------------------------------------------------------------------- */
/*  Host-only capabilities                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Permission to load remote media, by either route a napplet has.
 *
 * Not a Kehto capability and not a NAP domain — nothing on the wire consults it.
 * It exists because the sandbox CSP, not the ACL, is what decides whether a
 * napplet's `<img src="https://…">` resolves, and that decision deserves the
 * same per-version consent and the same revoke path as everything else.
 *
 * It governs both routes deliberately: the frame's own `img-src`/`media-src`/
 * `font-src`, and shell-mediated NAP-RESOURCE fetches. Gating only the first left
 * every napplet that asks the shell for bytes — which is most of them, and all of
 * the ones rendering custom emoji — with broken images for no security gain the
 * CSP was not already conceding.
 *
 * No manifest declares it (NIP-5D has no vocabulary for it), so it is offered on
 * every launch rather than derived from `requires`.
 */
export const REMOTE_MEDIA_CAPABILITY = "media:remote";

/**
 * Capabilities the host enforces itself.
 *
 * These must never be written into Kehto's ACL: the runtime would be holding a
 * grant for a capability no envelope can ever name, which is noise at best and a
 * capability-shaped hole in someone's audit at worst. They live only in our own
 * decision store.
 */
const HOST_CAPABILITIES = new Set<string>([REMOTE_MEDIA_CAPABILITY]);

export function isHostCapability(capability: string): boolean {
  return HOST_CAPABILITIES.has(capability);
}

/**
 * Every NAP domain this host knows how to map. Exported so a caller can ask
 * about the whole surface — the consent tests check that no two capabilities a
 * user can be asked about describe themselves the same way.
 */
export const NAP_DOMAINS: readonly string[] = Object.keys(DOMAIN_CAPABILITIES);

/** Capabilities implied by a set of declared domains, deduped and ordered. */
export function capabilitiesForDomains(domains: readonly string[]): string[] {
  const out = new Set<string>();
  for (const domain of domains) {
    for (const capability of DOMAIN_CAPABILITIES[domain] ?? []) {
      out.add(capability);
    }
  }
  return [...out];
}

/** Domains that carry no capability, so nothing can be granted or withheld. */
export function unenforceableDomains(domains: readonly string[]): string[] {
  return domains.filter(
    (d) => d in DOMAIN_CAPABILITIES && DOMAIN_CAPABILITIES[d].length === 0,
  );
}

/* -------------------------------------------------------------------------- */
/*  Declared-domain registry                                                   */
/* -------------------------------------------------------------------------- */

const declared = new Map<string, readonly string[]>();

function identityKey(dTag: string, aggregateHash: string): string {
  return `${dTag}:${aggregateHash}`;
}

/** Record what a verified manifest declared, before its frame is created. */
export function setDeclaredDomains(
  dTag: string,
  aggregateHash: string,
  requires: readonly string[],
): void {
  declared.set(identityKey(dTag, aggregateHash), [...requires]);
}

export function getDeclaredDomains(
  dTag: string,
  aggregateHash: string,
): readonly string[] | undefined {
  return declared.get(identityKey(dTag, aggregateHash));
}

/**
 * Narrow a napplet's advertised environment to the domains it declared.
 *
 * Kehto advertises every live domain to every napplet regardless of `requires`,
 * so a napplet that asked for `theme` can still reach `relay.publish` if the
 * capability is granted. Restricting the frozen environment makes the
 * declaration the napplet's whole surface, which is what makes granting
 * capabilities up front safe.
 *
 * A manifest with no `requires` gets the full set: it declared nothing, so
 * there is nothing to narrow to, and per-use consent remains its only gate.
 * `shell` is mandatory and always survives.
 */
export function narrowEnvironment(
  dTag: string,
  aggregateHash: string,
  available: { domains: readonly string[]; services: readonly string[] },
): { domains: readonly string[]; services: readonly string[] } {
  const requires = getDeclaredDomains(dTag, aggregateHash);
  if (!requires || requires.length === 0) return available;

  const allowed = new Set<string>([...requires, "shell"]);
  return {
    domains: available.domains.filter((d) => allowed.has(d)),
    services: available.services.filter((s) => allowed.has(s)),
  };
}
