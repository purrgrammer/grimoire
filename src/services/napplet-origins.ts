/**
 * Per-napplet network origin grants for NAP-RESOURCE.
 *
 * A browser host cannot meet Kehto's resource policy in full: the private-IP
 * block list must be checked *after DNS resolution and before TCP*, per
 * redirect hop, and a page can neither resolve DNS nor see the peer address.
 * So "fetch any https URL" is not offerable conformantly, and pretending
 * otherwise would be the same class of lie as `notify` fabricating delivery.
 *
 * What is offerable is a narrowed version: the user grants specific origins to
 * a specific napplet version, and those exact origins — nothing wildcarded —
 * become the frame's `connect-src`. Two independent gates then apply, and both
 * matter:
 *
 *  - the CSP, baked into the srcdoc before any napplet code runs, which stops
 *    the frame reaching anything else on its own;
 *  - this module, re-checked on every shell-mediated fetch, because the CSP
 *    governs the frame's own requests and not what the host does on its behalf.
 *
 * Grants are keyed per `(dTag, aggregateHash)` like capabilities, so a napplet
 * update re-asks rather than inheriting network reach.
 */

const ORIGINS_KEY = "napplet:origins";

type OriginMap = Record<string, string[]>;

function identityKey(dTag: string, aggregateHash: string): string {
  return `${dTag}:${aggregateHash}`;
}

function readOrigins(): OriginMap {
  try {
    const raw = localStorage.getItem(ORIGINS_KEY);
    const parsed = raw ? (JSON.parse(raw) as OriginMap) : {};
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeOrigins(map: OriginMap): void {
  try {
    localStorage.setItem(ORIGINS_KEY, JSON.stringify(map));
  } catch {
    // Losing a grant means the user is asked again — never a widening.
  }
}

/**
 * Reduce a URL to the exact origin that may be granted.
 *
 * Returns null for anything that is not plain https. `http:` is refused
 * because the bytes would be attacker-modifiable in transit, and a
 * credentialed or non-standard URL is refused rather than normalised — a
 * grant the user cannot read is not consent.
 */
export function canonicalOrigin(candidate: string): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** Origins this napplet version may reach. */
export function getGrantedOrigins(
  dTag: string,
  aggregateHash: string,
): string[] {
  return readOrigins()[identityKey(dTag, aggregateHash)] ?? [];
}

/** Grant exact origins. Anything not canonicalisable is dropped, not coerced. */
export function grantOrigins(
  dTag: string,
  aggregateHash: string,
  origins: readonly string[],
): void {
  const key = identityKey(dTag, aggregateHash);
  const map = readOrigins();
  const merged = new Set(map[key] ?? []);
  for (const origin of origins) {
    const canonical = canonicalOrigin(origin);
    if (canonical) merged.add(canonical);
  }
  writeOrigins({ ...map, [key]: [...merged].sort() });
}

export function revokeOrigins(dTag: string, aggregateHash: string): void {
  const map = readOrigins();
  delete map[identityKey(dTag, aggregateHash)];
  writeOrigins(map);
}

/**
 * Whether a request origin is covered by a grant.
 *
 * Exact match only. No subdomain widening, no scheme coercion, no prefix
 * matching — `https://evil.com/?x=https://granted.com` and
 * `https://granted.com.evil.com` must both fail.
 */
export function isOriginGranted(
  origin: string,
  grants: readonly string[],
): boolean {
  const canonical = canonicalOrigin(origin);
  return canonical !== null && grants.includes(canonical);
}

/** Origins a manifest asks for, from `connect` tags. Unverified until granted. */
export function requestedOrigins(tags: string[][]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== "connect" || !tag[1]) continue;
    const canonical = canonicalOrigin(tag[1]);
    if (canonical) out.add(canonical);
  }
  return [...out].sort();
}
