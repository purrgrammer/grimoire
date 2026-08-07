/**
 * NAP-RESOURCE.
 *
 * Kehto documents this one most heavily: its own policy requires
 * post-DNS private-IP blocking per redirect hop (including
 * 169.254.169.254), byte-sniffed MIME, SVG rasterisation in a worker, redirect
 * and size caps, and a scheme allowlist. A browser cannot resolve DNS or see
 * the peer address, so the private-IP rule is *unimplementable here* — which
 * means arbitrary https fetching cannot be offered conformantly at all. What is
 * safe is the non-network subset: `data:` and Blossom blobs addressed by hash,
 * where the bytes are verified against the hash rather than trusted.
 *
 * `serial`, `ble` and `webrtc` are deliberately not registered. Their browser
 * APIs require transient user activation, which a `postMessage` handler does
 * not have, so every call would reject no matter what we wrote. Leaving the
 * domains unadvertised is the spec's own signal for "unavailable" and lets a
 * napplet degrade; advertising them would be the lie. WebRTC additionally
 * bypasses `connect-src` entirely and carries no capability the ACL can check.
 */

import { createResourceService } from "@kehto/services";
import { getBlobUrl } from "./blossom";
import {
  getGrantedOrigins,
  isOriginGranted,
  canonicalOrigin,
} from "./napplet-origins";

/** Matches the artifact cache ceiling; a napplet cannot pull more in one go. */
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;

const ALLOWED_SCHEMES = ["data:", "blossom:"];

async function fetchAllowedResource(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    signal: AbortSignal;
  },
  grants: readonly string[] = [],
): Promise<Response> {
  if (url.startsWith("data:")) {
    return fetch(url, { signal: init.signal });
  }

  // blossom:sha256:<hex> — content-addressed, so the response is verifiable
  // and no napplet-chosen host is ever contacted.
  const blossom = /^blossom:sha256:([0-9a-f]{64})$/i.exec(url);
  if (blossom) {
    const sha256 = blossom[1].toLowerCase();
    const { getActiveAccountServers } = await import("./blossom");
    const servers = await getActiveAccountServers();
    for (const server of servers) {
      try {
        const res = await fetch(getBlobUrl(server, sha256), {
          signal: init.signal,
          cache: "no-store",
        });
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_RESOURCE_BYTES) break;
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hex = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        // The server is untrusted; only the hash decides.
        if (hex !== sha256) continue;
        return new Response(bytes);
      } catch {
        continue;
      }
    }
    throw new Error("blob unavailable or failed verification");
  }

  // Exactly the origins the user granted this napplet version. Re-checked
  // here rather than relying on the CSP alone: the CSP constrains the frame's
  // own requests, not what the host fetches on its behalf.
  if (isOriginGranted(url, grants)) {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      // Napplet-supplied headers are not forwarded — they could carry
      // credentials the napplet should not be able to make the host send.
      signal: init.signal,
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
    });
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_RESOURCE_BYTES) {
      throw new Error("resource exceeds the size limit");
    }
    // A redirect can leave the granted origin; the final URL decides.
    if (res.redirected && !isOriginGranted(res.url, grants)) {
      throw new Error("redirected outside the granted origins");
    }
    return new Response(bytes, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "" },
    });
  }

  const origin = canonicalOrigin(url);
  throw new Error(
    origin
      ? `${origin} is not granted to this napplet`
      : "only data:, blossom:sha256: and granted https origins can be fetched",
  );
}

export function createNappletResourceService(
  resolveIdentity: (
    windowId: string,
  ) => { dTag: string; aggregateHash: string } | null,
) {
  // Kehto calls getConnectGrants immediately before fetch for the same
  // request, so this carries the caller's grants across that pair. It is only
  // ever a narrowing: an empty list refuses everything.
  let currentGrants: readonly string[] = [];

  return createResourceService({
    // The grants belong to the requesting napplet, so the fetch has to be
    // resolved per call rather than closed over a fixed policy.
    fetch: (url, init) => fetchAllowedResource(url, init, currentGrants),
    isOriginGranted: (origin, grants) => isOriginGranted(origin, grants),
    getConnectGrants: (dTag, aggregateHash) => {
      currentGrants = getGrantedOrigins(dTag, aggregateHash);
      return currentGrants;
    },
    resolveIdentity,
    resourceInfo: {
      schemes: [...ALLOWED_SCHEMES, "https:"].map((scheme) => ({
        scheme,
        enabled: true,
      })),
      maxBytes: MAX_RESOURCE_BYTES,
    },
  });
}
