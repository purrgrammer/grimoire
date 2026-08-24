/**
 * The host half of an nsite's `window.nostr`.
 *
 * The frame shim in `nsite-serve.ts` turns every NIP-07 call into a
 * `postMessage`; this answers them. Reusing `createNappletSigner` is the point
 * rather than a shortcut — it already confirms the operations a standing grant
 * must not cover (kind 0/3/5/10002, and any encryption to a recipient the page
 * chose), and an nsite deserves exactly the same treatment. A verified site is
 * still someone else's code running under the user's key.
 *
 * Messages are matched by the frame's own `contentWindow`, never by origin: an
 * nsite is served from grimoire's origin, so origin proves nothing about which
 * frame — or whether it is a frame at all — sent the call.
 */

import { createNappletSigner } from "./napplet-signer";
import accountManager from "./accounts";
import type { NostrEvent } from "@/types/nostr";

interface Call {
  __nsite: "call";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

function isCall(data: unknown): data is Call {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Call).__nsite === "call" &&
    typeof (data as Call).id === "number" &&
    typeof (data as Call).method === "string"
  );
}

async function dispatch(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const signer = createNappletSigner();
  const active = accountManager.active;

  switch (method) {
    case "getPublicKey": {
      const pubkey = signer.getPublicKey();
      if (!pubkey) throw new Error("No account is signed in.");
      return pubkey;
    }
    case "signEvent":
      return signer.signEvent(params.event as NostrEvent);
    case "getRelays":
      // NIP-07 wants `{ [url]: {read, write} }`. Grimoire's relay list lives on
      // the account's own mailbox; an nsite gets what the user publishes, not
      // grimoire's internal pool.
      return {};
    case "nip44.encrypt":
      return signer.nip44.encrypt(
        String(params.pubkey),
        String(params.plaintext),
      );
    case "nip44.decrypt":
      return signer.nip44.decrypt(
        String(params.pubkey),
        String(params.ciphertext),
      );
    case "nip04.encrypt": {
      if (!active?.nip04) throw new Error("NIP-04 unavailable.");
      return active.nip04.encrypt(
        String(params.pubkey),
        String(params.plaintext),
      );
    }
    case "nip04.decrypt": {
      if (!active?.nip04) throw new Error("NIP-04 unavailable.");
      return active.nip04.decrypt(
        String(params.pubkey),
        String(params.ciphertext),
      );
    }
    default:
      throw new Error(`window.nostr.${method} is not supported here.`);
  }
}

/**
 * Answer NIP-07 calls from one frame, until the returned function is called.
 *
 * `frame` is read lazily so a caller can attach before the iframe has a
 * `contentWindow`, which it does not until it is in the document.
 */
export function attachNsiteBridge(frame: () => Window | null): () => void {
  const onMessage = async (event: MessageEvent) => {
    const source = frame();
    if (!source || event.source !== source) return;
    if (!isCall(event.data)) return;

    const { id, method, params } = event.data;
    try {
      const result = await dispatch(method, params);
      source.postMessage({ __nsite: "reply", id, result }, "*");
    } catch (error) {
      source.postMessage(
        {
          __nsite: "reply",
          id,
          error: error instanceof Error ? error.message : String(error),
        },
        "*",
      );
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
