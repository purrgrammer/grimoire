/**
 * Encrypted community images — CORD-02 §6.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/image.ts` +
 * `decryptBuffer`/`fetchCapped` from `src/lib/encryptedMedia.ts`), read side
 * only: grimoire uploads nothing.
 *
 * An icon or banner is not a URL you can put in an `<img src>`. The media host
 * stores CIPHERTEXT, the per-image AES-256-GCM key and nonce ride inside the
 * member-sealed metadata, and `hash` is the SHA-256 of the PLAINTEXT so a
 * swapped blob fails closed.
 *
 * That last part is the point and the reason this is not a two-line fetch: the
 * host is untrusted. It can serve different bytes than the ones the community's
 * staff uploaded, and without checking the plaintext hash a client renders
 * whatever it is handed. Verification is what makes an untrusted host safe.
 *
 * **The nonce is 16 bytes, not 12.** Armada mints it that width, "matching
 * Vector's AES-GCM parameters" — and AES-GCM permits any IV length, so nothing
 * here pins one. An earlier version of this file assumed 12 (the NIP-44 and
 * general-practice default) and refused every real community icon. Widths are
 * left to WebCrypto exactly as armada leaves them; the integrity check is what
 * decides whether the bytes are good.
 */

import { bytesToHex, hexToBytes } from "@/lib/concord/derive";
import type { ImagePointer } from "@/lib/concord/types";

/** Ceiling on an icon/banner read — armada's, generous for an image but bounded. */
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export class EncryptedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptedImageError";
  }
}

/** A fresh ArrayBuffer-backed view — WebCrypto wants a real BufferSource. */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

/**
 * Best-effort mime from magic bytes — armada's sniffer, and NOT cosmetic.
 *
 * The pointer carries no extension and no mime, so a Blob built without one has
 * an empty type and a browser will not render it in an `<img>`. The bytes are
 * already integrity-checked by the time this runs, so sniffing them is safe.
 */
export function sniffImageMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 5 && bytes[0] === 0x3c) return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Fetch, decrypt and VERIFY one encrypted blob.
 *
 * Throws rather than returning something unverified: a caller that rendered on
 * error would defeat the hash check, so there is deliberately no partial
 * success to mistake for one.
 */
export async function fetchEncryptedBlob(
  pointer: { url: string; key: string; nonce: string; hash: string },
  opts: { signal?: AbortSignal } = {},
): Promise<{ bytes: Uint8Array; mime: string }> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(pointer.url, { signal });
  } catch (error) {
    throw new EncryptedImageError(
      `could not reach the media host: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new EncryptedImageError(
      `media host answered ${response.status} for ${pointer.url}`,
    );
  }
  const ciphertext = await response.arrayBuffer();
  // An icon is small by definition and this runs unprompted the moment a
  // community renders, so cap the read rather than letting a pointer choose how
  // much memory a community costs to display.
  if (ciphertext.byteLength > MAX_IMAGE_BYTES) {
    throw new EncryptedImageError(
      `blob is ${ciphertext.byteLength} bytes, over the ${MAX_IMAGE_BYTES} ceiling`,
    );
  }

  let plain: ArrayBuffer;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      buf(hexToBytes(pointer.key.toLowerCase())),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(hexToBytes(pointer.nonce.toLowerCase())) },
      key,
      ciphertext,
    );
  } catch {
    // GCM authenticates, so this already means tampered, wrong key, or a
    // malformed key/nonce width. The hash check below is the second and
    // independent statement of the same refusal.
    throw new EncryptedImageError("blob did not decrypt under the given key");
  }

  const bytes = new Uint8Array(plain);
  const digest = bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", plain)),
  );
  if (digest !== pointer.hash.toLowerCase()) {
    // CORD-02 §6's fail-closed rule. Reaching here means the host served
    // something that decrypted but is not what the community committed to.
    throw new EncryptedImageError("blob does not match its committed hash");
  }
  return { bytes, mime: sniffImageMime(bytes) };
}

/**
 * An object URL for one encrypted image, or undefined.
 *
 * Memoized by pointer identity (url + hash), because the same community icon is
 * asked for by every window that lists it and each miss costs a round trip plus
 * a decrypt. The URLs are deliberately NOT revoked: they live as long as the
 * document, and revoking one while another view still renders it would blank an
 * image that is perfectly valid.
 */
const objectUrls = new Map<string, Promise<string | undefined>>();

export function encryptedImageUrl(
  pointer: ImagePointer | undefined,
): Promise<string | undefined> {
  if (!pointer) return Promise.resolve(undefined);
  const memoKey = `${pointer.url}|${pointer.hash}`;
  const cached = objectUrls.get(memoKey);
  if (cached) return cached;

  const work = fetchEncryptedBlob(pointer)
    .then(({ bytes, mime }) =>
      URL.createObjectURL(new Blob([buf(bytes)], { type: mime })),
    )
    .catch((error: unknown) => {
      console.debug("[concord] could not load an encrypted image:", error);
      // Remembered as a failure rather than retried on every render: a bad
      // pointer stays bad, and the community's next metadata edition mints a
      // new one with a different hash, which misses this memo.
      return undefined;
    });
  objectUrls.set(memoKey, work);
  return work;
}

/** Test seam: forget every memoized image. */
export function _resetEncryptedImagesForTests(): void {
  objectUrls.clear();
}
