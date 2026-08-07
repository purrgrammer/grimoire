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
export function buildCspPolicy(origins: readonly string[]): string {
  const grantedOrigins = [...new Set(origins)].sort();
  const connectSrc =
    grantedOrigins.length > 0
      ? `connect-src ${grantedOrigins.join(" ")}`
      : "connect-src 'none'";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    connectSrc,
    "worker-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "prefetch-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
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
 */
export function injectCspMeta(
  html: string,
  origins: readonly string[],
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", buildCspPolicy(origins));
  doc.head.prepend(meta);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
