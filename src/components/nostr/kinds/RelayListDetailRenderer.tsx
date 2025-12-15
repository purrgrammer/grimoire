import { NostrEvent } from "@/types/nostr";
import { getInboxes, getOutboxes } from "applesauce-core/helpers/mailboxes";
import { RelayLink } from "../RelayLink";

interface RelayWithMode {
  url: string;
  read: boolean;
  write: boolean;
}

/**
 * Kind 10002 Detail Renderer - NIP-65 Relay List Metadata (Detail View)
 * Shows full relay list with read/write indicators
 */
export function Kind10002DetailRenderer({ event }: { event: NostrEvent }) {
  const inboxRelays = getInboxes(event);
  const outboxRelays = getOutboxes(event);

  // Combine into unified list with read/write flags
  const relayMap = new Map<string, RelayWithMode>();

  inboxRelays.forEach((url) => {
    const existing = relayMap.get(url);
    if (existing) {
      existing.read = true;
    } else {
      relayMap.set(url, { url, read: true, write: false });
    }
  });

  outboxRelays.forEach((url) => {
    const existing = relayMap.get(url);
    if (existing) {
      existing.write = true;
    } else {
      relayMap.set(url, { url, read: false, write: true });
    }
  });

  const allRelays = Array.from(relayMap.values());

  if (allRelays.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No relays configured
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {/*
      <h1 className="text-2xl font-bold">Relay List ({allRelays.length})</h1>
       */}
      {allRelays.map((relay) => (
        <RelayLink
          key={relay.url}
          url={relay.url}
          read={relay.read}
          write={relay.write}
          urlClassname="text-md underline decoration-dotted"
          iconClassname="size-4"
        />
      ))}
    </div>
  );
}
