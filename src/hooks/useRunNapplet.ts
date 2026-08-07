import { nip19 } from "nostr-tools";
import { useAddWindow } from "@/core/state";
import { getNappletIdentifier } from "@/lib/nip5d-helpers";
import { NAPPLET_KIND_SNAPSHOT } from "@/lib/napplet-parser";
import type { NostrEvent } from "@/types/nostr";

/**
 * Open a manifest in the `app` window. Grimoire re-resolves and re-verifies on
 * mount, so only the pointer is handed over — never anything read off the tags
 * here, which are unverified.
 */
export function useRunNapplet(event: NostrEvent) {
  const addWindow = useAddWindow();

  return () => {
    // Snapshots (5129) are regular events and pin one version by design, so an
    // event id is the right pointer. Root (15129) and named (35129) manifests
    // are replaceable/addressable: an id would go stale the moment the author
    // republishes, and that pointer is durable — it persists to localStorage
    // and into published spellbooks. Address those by coordinate. A root
    // manifest has no d tag, so its identifier is the empty string.
    if (event.kind === NAPPLET_KIND_SNAPSHOT) {
      const pointer = { id: event.id, author: event.pubkey, kind: event.kind };
      addWindow(
        "app",
        { pointer },
        `app ${nip19.neventEncode(pointer)}`,
        undefined,
      );
      return;
    }

    const pointer = {
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: getNappletIdentifier(event) ?? "",
    };
    addWindow(
      "app",
      { pointer },
      `app ${nip19.naddrEncode(pointer)}`,
      undefined,
    );
  };
}
