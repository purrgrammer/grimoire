import { NostrEvent } from "@/types/nostr";
import { RelayLink } from "../RelayLink";

/**
 * Kind 10317 Detail Renderer - User Grasp List (Detail View)
 * Shows full list of grasp service relays
 */
export function Kind10317DetailRenderer({ event }: { event: NostrEvent }) {
  // Extract grasp relay URLs from g tags
  const graspRelays = event.tags
    .filter((tag) => tag[0] === "g" && tag[1])
    .map((tag) => tag[1]);

  if (graspRelays.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No grasp relays configured
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {graspRelays.map((url, index) => (
        <RelayLink
          key={`${url}-${index}`}
          url={url}
          urlClassname="text-md underline decoration-dotted"
          iconClassname="size-4"
        />
      ))}
    </div>
  );
}
