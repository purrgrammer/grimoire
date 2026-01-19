/**
 * Semantic Author Utilities
 *
 * Determines the "semantic author" of an event based on kind-specific logic.
 * For most events, this is event.pubkey, but for certain event types the
 * semantic author may be different (e.g., zapper for zaps, host for streams).
 */

import type { NostrEvent } from "@/types/nostr";
import { getZapSender } from "applesauce-common/helpers/zap";
import { getLiveHost } from "@/lib/live-activity";

/**
 * Get the semantic author of an event based on kind-specific logic
 * Returns the pubkey that should be displayed as the "author" for UI purposes
 *
 * Examples:
 * - Zaps (9735): Returns the zapper (P tag), not the lightning service pubkey
 * - Live activities (30311): Returns the host (first p tag with "Host" role)
 * - Regular events: Returns event.pubkey
 *
 * This function should be used when determining:
 * - Who to display as the author in UI
 * - Who to zap when zapping an event
 * - Who the "owner" of the event is semantically
 */
export function getSemanticAuthor(event: NostrEvent): string {
  switch (event.kind) {
    case 9735: {
      // Zap: show the zapper, not the lightning service pubkey
      const zapSender = getZapSender(event);
      return zapSender || event.pubkey;
    }
    case 30311: {
      // Live activity: show the host
      return getLiveHost(event);
    }
    default:
      return event.pubkey;
  }
}
