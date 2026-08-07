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

  throw new Error(
    "only data: and blossom:sha256: resources can be fetched; arbitrary network access is not offered",
  );
}

export function createNappletResourceService(
  resolveIdentity: (
    windowId: string,
  ) => { dTag: string; aggregateHash: string } | null,
) {
  return createResourceService({
    fetch: fetchAllowedResource,
    // No origin is ever granted: no scheme here reaches a napplet-chosen host.
    isOriginGranted: () => false,
    getConnectGrants: () => [],
    resolveIdentity,
    resourceInfo: {
      schemes: ALLOWED_SCHEMES.map((scheme) => ({ scheme, enabled: true })),
      maxBytes: MAX_RESOURCE_BYTES,
    },
  });
}
