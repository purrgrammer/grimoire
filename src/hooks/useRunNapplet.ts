import { nip19 } from "nostr-tools";
import { useAddWindow } from "@/core/state";
import { getNappletIdentifier } from "@/lib/nip5d-helpers";
import type { NostrEvent } from "@/types/nostr";

/**
 * Open a manifest in the `app` window. Grimoire re-resolves and re-verifies on
 * mount, so only the pointer is handed over — never anything read off the tags
 * here, which are unverified.
 */
export function useRunNapplet(event: NostrEvent) {
  const addWindow = useAddWindow();

  return () => {
    const identifier = getNappletIdentifier(event);
    if (identifier !== undefined) {
      const pointer = {
        kind: event.kind,
        pubkey: event.pubkey,
        identifier,
      };
      addWindow(
        "app",
        { pointer },
        `app ${nip19.naddrEncode(pointer)}`,
        undefined,
      );
      return;
    }
    // Snapshots (5129) have no d tag; address them by event id instead.
    const pointer = { id: event.id, author: event.pubkey, kind: event.kind };
    addWindow(
      "app",
      { pointer },
      `app ${nip19.neventEncode(pointer)}`,
      undefined,
    );
  };
}
