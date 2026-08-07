/**
 * Inject Kehto's Class-1 Content-Security-Policy `<meta http-equiv>` into the
 * assembled HTML. A `srcdoc` document has an opaque origin and no HTTP
 * response, so the policy has to travel inside the document itself.
 *
 * Ported from Kehto's playground (`apps/playground/src/napplet-resolver.ts`) —
 * it is Kehto *policy* rather than Kehto *API* and is not exported from any
 * published package. The exact directive string is asserted in the tests; treat
 * a diff there as a security review, not a formatting change.
 */
export function injectCspMeta(
  html: string,
  origins: readonly string[],
): string {
  const grantedOrigins = [...new Set(origins)].sort();
  const connectSrc =
    grantedOrigins.length > 0
      ? `connect-src ${grantedOrigins.join(" ")}`
      : "connect-src 'none'";
  const value = [
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
  const meta = `<meta http-equiv="Content-Security-Policy" content="${value}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (open) => `${open}${meta}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /<html[^>]*>/i,
      (open) => `${open}<head>${meta}</head>`,
    );
  }
  return `${meta}${html}`;
}
