import { EyeOff } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";

/**
 * Renderer for NIP-28 Hide Message (kind 43)
 */
export function ChannelHideRenderer({ event, depth }: BaseEventProps) {
  // Get the message being hidden (e tag)
  const eTag = event.tags.find((t) => t[0] === "e");
  const hiddenMessageId = eTag?.[1];

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
          <EyeOff className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm text-muted-foreground">
              Hid channel message
            </span>
            {hiddenMessageId && (
              <div className="text-xs text-muted-foreground font-mono mt-1">
                {hiddenMessageId.slice(0, 8)}...
              </div>
            )}
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
