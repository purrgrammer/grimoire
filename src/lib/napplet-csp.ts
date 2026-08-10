/**
 * Kehto's Class-1 Content-Security-Policy for napplet iframes.
 *
 * A `srcdoc` document has an opaque origin and no HTTP response, so the policy
 * has to travel inside the document itself. Ported from Kehto's playground
 * (`apps/playground/src/napplet-resolver.ts`) — it is Kehto *policy* rather
 * than Kehto *API* and is not exported from any published package. The exact
 * directive string is asserted in the tests; treat a diff there as a security
 * review, not a formatting change.
 */
/**
 * What a napplet may load, beyond its own verified bytes.
 *
 * `remoteMedia` widens `img-src`/`media-src`/`font-src` to `https:`. It is a
 * genuine loosening and not a cosmetic one: a media load is an outbound GET, so
 * a napplet holding this can signal out without ever being granted network
 * access. That is why it is a per-`(dTag, aggregateHash)` grant the user can
 * revoke rather than part of the baseline — see `napplet-media.ts`.
 *
 * The alternative was leaving every feed and profile napplet with broken images,
 * which is not a defensible default either.
 */
export interface CspGrants {
  remoteMedia?: boolean;
}

export function buildCspPolicy(
  origins: readonly string[],
  grants: CspGrants = {},
): string {
  const grantedOrigins = [...new Set(origins)].sort();
  const connectSrc =
    grantedOrigins.length > 0
      ? `connect-src ${grantedOrigins.join(" ")}`
      : "connect-src 'none'";
  const media = grants.remoteMedia;
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    media ? "img-src data: blob: https:" : "img-src data: blob:",
    media ? "media-src data: blob: https:" : "media-src 'none'",
    media ? "font-src data: https:" : "font-src data:",
    connectSrc,
    "worker-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "prefetch-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** A napplet document whose policy could not be placed where it takes effect. */
export class CspInjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CspInjectionError";
  }
}

/**
 * Inject the CSP `<meta http-equiv>` as the first element of `<head>`.
 *
 * The napplet body is attacker-controlled, so this must not be done by regex.
 * Text matching on `<head>` can be defeated two ways: a `<script>` placed
 * *before* the head token still runs before the parser reaches the injected
 * meta, and a `<!--<head>-->` decoy comment swallows the meta so the document
 * ships with no policy at all. Either one restores unrestricted `fetch` and
 * WebSocket access from the sandbox, which is exactly what `connect-src 'none'`
 * exists to prevent.
 *
 * Parsing to a document and prepending makes "first element in head"
 * structurally true for any input. `DOMParser` does not execute scripts, and
 * the parser hoists stray leading content into the head/body it synthesizes,
 * so nothing can sit ahead of the policy in the serialized output.
 *
 * **This must be the last thing written into a napplet document.** Attribute
 * serialization escapes `&` and `"` but not `<`, so a decoy
 * `<meta http-equiv="Content-Security-Policy">` inside an attribute on `<html>`
 * survives this pass verbatim and sits *ahead* of the real one in the output.
 * Anything that string-matches the policy meta afterwards — Kehto's own prelude
 * injector does exactly that — hits the decoy and splices its payload into the
 * attribute value, whose first quote and `>` then terminate the tag. The
 * remainder becomes character data before `<head>`, which forces an implicit
 * empty head, and the real meta lands in `<body>` where a `http-equiv` policy
 * is ignored. The document then ships with no CSP at all. Verified with a
 * spec-compliant tree builder; the reparse below is what makes it loud rather
 * than silent if the ordering is ever changed back.
 */
export function injectCspMeta(
  html: string,
  origins: readonly string[],
  grants: CspGrants = {},
): string {
  const policy = buildCspPolicy(origins, grants);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", policy);
  doc.head.prepend(meta);
  const out = `<!doctype html>${doc.documentElement.outerHTML}`;

  // Prepending to `doc.head` is not the same claim as "the browser will parse
  // this string back into a document whose head holds the policy". Check the
  // output rather than trusting the tree we built it from.
  assertPolicyInHead(out, policy);
  return out;
}

function assertPolicyInHead(html: string, policy: string): void {
  const head = new DOMParser().parseFromString(html, "text/html").head;
  const applied = head?.querySelector(
    'meta[http-equiv="Content-Security-Policy"]',
  );
  if (applied?.getAttribute("content") !== policy) {
    throw new CspInjectionError(
      "the napplet's HTML displaced the Content-Security-Policy out of <head>, where it would not take effect",
    );
  }
}
