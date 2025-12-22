import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { RelayLink } from "../RelayLink";

/**
 * Kind 10317 Renderer - User Grasp List (Feed View)
 * Shows list of grasp service relays
 */
export function Kind10317Renderer({ event }: BaseEventProps) {
  // Extract grasp relay URLs from g tags
  const graspRelays = event.tags
    .filter((tag) => tag[0] === "g" && tag[1])
    .map((tag) => tag[1]);

  if (graspRelays.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No grasp relays configured
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-0.5">
        {graspRelays.map((url, index) => (
          <RelayLink
            key={`${url}-${index}`}
            url={url}
            className="py-0.5 hover:bg-none"
            iconClassname="size-4"
            urlClassname="underline decoration-dotted"
          />
        ))}
      </div>
    </BaseEventContainer>
  );
}
