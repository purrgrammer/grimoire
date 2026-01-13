import { Eye } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { UserName } from "../UserName";

/**
 * Renderer for NIP-28 Mute User (kind 44)
 */
export function ChannelMuteRenderer({ event, depth }: BaseEventProps) {
  // Get the user being muted (p tag)
  const pTag = event.tags.find((t) => t[0] === "p");
  const mutedPubkey = pTag?.[1];

  // Parse reason from content (optional JSON)
  let reason: string | undefined;
  try {
    const parsed = JSON.parse(event.content);
    reason = parsed.reason;
  } catch {
    // Not JSON or no reason
  }

  return (
    <BaseEventContainer event={event}>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Eye className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm text-muted-foreground">Muted user: </span>
            {mutedPubkey && <UserName pubkey={mutedPubkey} />}
            {reason && (
              <div className="text-xs text-muted-foreground mt-1">
                Reason: {reason}
              </div>
            )}
          </div>
        </div>
      </div>
    </BaseEventContainer>
  );
}
