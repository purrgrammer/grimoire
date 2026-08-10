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

/**
 * Grant exact origins. Anything not canonicalisable is dropped, not coerced.
 *
 * No UI calls this yet, so in practice every napplet runs with
 * `connect-src 'none'` and the granted-origin branches downstream are unreached.
 * The mechanism is kept — tested, and the enforcement side is what makes the
 * content-addressed path safe — but nothing here should be described as a
 * feature the user has until a grant surface exists.
 */
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

/**
 * The sha256 a URL names itself by, if it is content-addressed.
 *
 * A Blossom URL is `https://<host>/<sha256>[.ext]`, and bytes that hash to their
 * own name need no trust in the host that served them: either the digest matches
 * or the response is discarded. So these are fetchable without any origin grant —
 * the verification, not the user, is what makes it safe. Nearly all media on
 * Nostr is addressed this way, which is why this exists instead of a prompt per
 * avatar host.
 *
 * Deliberately strict: exactly one path segment, exactly 64 hex, at most one
 * extension, no query and no fragment. A loose match here would quietly turn the
 * gate into `https:` for anyone able to put 64 hex characters in a URL.
 */
export function contentAddressedSha256(candidate: string): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  const match = /^\/([0-9a-f]{64})(\.[0-9a-z]{1,8})?$/i.exec(url.pathname);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Whether a shell-mediated fetch of this URL is allowed, and why.
 *
 * Three ways in, in order of how much trust each needs:
 *
 *  - `content-addressed` — the path is the sha256, so the digest decides and the
 *    serving host is irrelevant. Needs nothing granted.
 *  - `granted-origin` — this exact origin was granted to this napplet version.
 *  - `remote-media` — the napplet holds `media:remote`, so it may reach any
 *    https origin through the shell.
 *
 * `remote-media` exists because the alternative was incoherent, not because it is
 * free. With that grant the frame's CSP already permits `img-src https:`, so the
 * napplet can load any remote image directly; refusing the shell-mediated path
 * for the same image only broke the napplets that ask for bytes rather than
 * setting `<img src>` — which is most of them, and all of the ones rendering
 * custom emoji, whose URLs are almost never content-addressed.
 *
 * What it does add over `<img>` is the bytes themselves: a cross-origin image
 * taints a canvas, a shell fetch does not, so this reads responses CORS would
 * otherwise withhold. Mitigated but not eliminated by `canonicalOrigin` refusing
 * anything but plain https, credentials being omitted, napplet headers never
 * being forwarded, and the size cap. It is a per-version grant the user can
 * revoke for exactly that reason.
 */
export type ResourceAllowance =
  "content-addressed" | "granted-origin" | "remote-media" | null;

export function resourceAllowance(
  url: string,
  policy: { remoteMedia: boolean; grants: readonly string[] },
): ResourceAllowance {
  if (contentAddressedSha256(url)) return "content-addressed";
  if (isOriginGranted(url, policy.grants)) return "granted-origin";
  // Still requires plain https with no credentials — `canonicalOrigin` is the
  // scheme gate, not a formatting helper.
  if (policy.remoteMedia && canonicalOrigin(url)) return "remote-media";
  return null;
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
