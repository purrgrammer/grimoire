import type { NostrEvent } from "@/types/nostr";
import { Mic } from "lucide-react";

/**
 * Compact preview for Kind 1222 (Voice Message) and Kind 1244 (Voice Reply)
 * Shows mic icon only
 */
export function VoiceMessageCompactPreview(_props: { event: NostrEvent }) {
  return (
    <span className="flex items-center text-muted-foreground">
      <Mic className="size-3.5" />
    </span>
  );
}
