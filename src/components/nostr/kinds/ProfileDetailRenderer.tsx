import { ProfileViewer } from "@/components/ProfileViewer";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 0 - Profile Metadata
 * Uses the ProfileViewer component to show full profile view
 */
export function Kind0DetailRenderer({ event }: { event: NostrEvent }) {
  return <ProfileViewer pubkey={event.pubkey} />;
}
