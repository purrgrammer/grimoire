/**
 * A displayable URL for a possibly-encrypted attachment.
 *
 * A Concord chat attachment ships as an `imeta` carrying `decryption-key`,
 * `decryption-nonce` and `ox` beside a Blossom URL whose body is CIPHERTEXT —
 * the same scheme community icons use (CORD-02 §6). Handing that URL to an
 * `<img>` renders a broken image, which is exactly what it did.
 *
 * Returns the plain URL untouched when there is nothing to decrypt, so every
 * caller can use this unconditionally.
 */

import { useEffect, useState } from "react";

import { encryptedImageUrl } from "@/lib/concord/image";
import { encryptedPointerOf, type ImetaEntry } from "@/lib/imeta";

export interface DecryptedMedia {
  /** What to render, or undefined while decrypting or after a failure. */
  url: string | undefined;
  /** Whether this attachment is encrypted at all. */
  encrypted: boolean;
  /** Decryption or verification failed — the caller must NOT fall back. */
  failed: boolean;
}

export function useDecryptedMedia(
  url: string,
  imeta: ImetaEntry | undefined,
): DecryptedMedia {
  const pointer = encryptedPointerOf(imeta);
  const [state, setState] = useState<{ key: string; url?: string }>();
  const key = pointer ? `${pointer.url}|${pointer.hash}` : "";

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void encryptedImageUrl(encryptedPointerOf(imeta)).then((resolved) => {
      if (!cancelled) setState({ key, url: resolved });
    });
    return () => {
      cancelled = true;
    };
    // The pointer is rebuilt on every render; its identity is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!pointer) return { url, encrypted: false, failed: false };
  const settled = state?.key === key ? state : undefined;
  return {
    url: settled?.url,
    encrypted: true,
    // A failure must never fall back to the ciphertext URL: rendering whatever
    // the host served is precisely what the hash check exists to prevent.
    failed: settled !== undefined && settled.url === undefined,
  };
}
