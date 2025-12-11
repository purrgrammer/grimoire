import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { getInboxes, getOutboxes } from "applesauce-core/helpers/mailboxes";
import { RelayLink } from "../RelayLink";

interface RelayWithMode {
  url: string;
  read: boolean;
  write: boolean;
}

/**
 * Kind 10002 Renderer - NIP-65 Relay List Metadata (Feed View)
 * Shows relay list with read/write indicators
 */
export function Kind10002Renderer({ event }: BaseEventProps) {
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
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No relays configured
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-0.5">
        {allRelays.map((relay) => (
          <RelayLink
            key={relay.url}
            url={relay.url}
            read={relay.read}
            write={relay.write}
            className="py-0.5 hover:bg-none"
            iconClassname="size-4"
            urlClassname="underline decoration-dotted"
          />
        ))}
      </div>
    </BaseEventContainer>
  );
}
