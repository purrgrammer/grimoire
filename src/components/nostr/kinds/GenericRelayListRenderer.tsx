import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import { RelayLink } from "../RelayLink";

/**
 * Generic Relay List Renderer
 * Works for NIP-51 relay list kinds: 10006, 10007, 10012, 10050, 30002
 * These lists contain simple "relay" tags without read/write distinction
 */
export function GenericRelayListRenderer({ event }: BaseEventProps) {
  // Extract relay URLs from the list (supports both public and encrypted)
  const relays = getRelaysFromList(event, "all");

  if (relays.length === 0) {
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
        {relays.map((url) => (
          <RelayLink
            key={url}
            url={url}
            showInboxOutbox={false}
            className="py-0.5 hover:bg-none"
            iconClassname="size-4"
            urlClassname="underline decoration-dotted"
          />
        ))}
      </div>
    </BaseEventContainer>
  );
}
