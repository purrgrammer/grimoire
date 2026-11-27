import { Capacitor } from "@capacitor/core";
import { nip19 } from "nostr-tools";

/**
 * The one place web and the Android build differ in *policy*.
 *
 * Grimoire ships as a website and as a Capacitor app that bundles the same
 * build. Inside the app the page is served from `https://localhost`, so
 * anything that derives a public URL from `location.origin` would hand people
 * a link that only resolves on the sender's phone. Everything here is pure or
 * trivially guarded so the web build keeps its exact behaviour.
 */

/** Where Grimoire lives on the web. Shareable links always point here. */
export const CANONICAL_ORIGIN = "https://grimoire.rocks";

/** True inside the Android (Capacitor) build, false on the web. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * The origin to put in links other people will open.
 *
 * On the web that is wherever this copy is served (a Vercel preview links to
 * itself). In the app it is the canonical site, never `https://localhost`.
 */
export function publicOrigin(): string {
  if (!isNativeApp()) return window.location.origin;
  const configured = import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined;
  return configured ? configured.replace(/\/+$/, "") : CANONICAL_ORIGIN;
}

/** `publicOrigin()` + a path that starts with `/`. */
export function publicUrl(path: string): string {
  return `${publicOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Schemes the app hands to Android for another app (browser, wallet, signer)
 * to open. Anything not listed is refused: `javascript:`, `data:`, `file:`,
 * `content:` and `intent:` URLs never leave the WebView.
 */
export const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set([
  "https:",
  "http:",
  "mailto:",
  "lightning:",
  "bitcoin:",
  "nostrconnect:",
]);

const NIP19_PREFIXES = ["npub1", "note1", "nevent1", "naddr1", "nprofile1"];

/**
 * Map a NIP-21 `nostr:` URI to the in-app route that shows it, or null.
 *
 * Only identifiers the router can open are accepted, and each must decode —
 * a well-formed prefix with a broken checksum is refused rather than routed
 * to a 404. `nprofile` is mapped to its `npub`, which the router does take.
 */
export function nostrUriToPath(uri: string): string | null {
  const raw = uri.replace(/^nostr:(\/\/)?/i, "").trim();
  if (!NIP19_PREFIXES.some((p) => raw.toLowerCase().startsWith(p))) {
    return null;
  }
  try {
    const decoded = nip19.decode(raw);
    if (decoded.type === "nprofile") {
      return `/${nip19.npubEncode(decoded.data.pubkey)}`;
    }
    if (
      decoded.type === "npub" ||
      decoded.type === "note" ||
      decoded.type === "nevent" ||
      decoded.type === "naddr"
    ) {
      return `/${raw}`;
    }
  } catch {
    return null;
  }
  return null;
}

export type Navigation =
  /** A route of this app: navigate the router, never the WebView. */
  | { kind: "internal"; path: string }
  /** Hand to Android for another app to open. */
  | { kind: "external"; url: string }
  /** Refuse silently-dangerous or unparseable targets. */
  | { kind: "blocked"; reason: string };

/**
 * Decide what a link, `window.open` or deep link should do.
 *
 * `appOrigin` is the origin the page is served from (`https://localhost` in
 * the app). Links to the canonical site count as internal so a shared
 * grimoire.rocks link opens in the app that received it.
 */
export function classifyNavigation(
  href: string,
  appOrigin: string,
): Navigation {
  let url: URL;
  try {
    url = new URL(href, appOrigin);
  } catch {
    return { kind: "blocked", reason: "unparseable URL" };
  }

  if (url.protocol === "nostr:") {
    const path = nostrUriToPath(href);
    return path
      ? { kind: "internal", path }
      : { kind: "blocked", reason: "unsupported nostr: identifier" };
  }

  // `blob:https://localhost/…` reports the app's origin too; only a real
  // http(s) URL can be a route.
  const isWeb = url.protocol === "https:" || url.protocol === "http:";
  if (isWeb && (url.origin === appOrigin || url.origin === CANONICAL_ORIGIN)) {
    return {
      kind: "internal",
      path: `${url.pathname}${url.search}${url.hash}`,
    };
  }

  if (EXTERNAL_SCHEMES.has(url.protocol)) {
    return { kind: "external", url: url.href };
  }

  return { kind: "blocked", reason: `scheme ${url.protocol} is not allowed` };
}
