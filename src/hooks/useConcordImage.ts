/**
 * An object URL for an encrypted Concord image (CORD-02 §6), or undefined.
 *
 * Undefined covers every reason the image is not showable — no pointer, a host
 * that would not serve it, a blob that did not decrypt, or one whose plaintext
 * hash did not match what the community committed to. The caller renders a
 * fallback for all of them, because a client that distinguished "not there"
 * from "failed verification" by SHOWING something would defeat the check.
 */

import { useEffect, useState } from "react";

import { encryptedImageUrl } from "@/lib/concord/image";
import type { ImagePointer } from "@/lib/concord/types";

export function useConcordImage(
  pointer: ImagePointer | undefined,
): string | undefined {
  // Keyed by subject, so a list of communities never shows one's icon against
  // another's name while the next fetch is in flight.
  const [loaded, setLoaded] = useState<{ key: string; url: string }>();
  const key = pointer ? `${pointer.url}|${pointer.hash}` : "";

  useEffect(() => {
    if (!pointer) return;
    let cancelled = false;
    void encryptedImageUrl(pointer).then((url) => {
      if (!cancelled && url) setLoaded({ key, url });
    });
    return () => {
      cancelled = true;
    };
    // The pointer object is rebuilt by every fold; its identity is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return loaded?.key === key ? loaded.url : undefined;
}
