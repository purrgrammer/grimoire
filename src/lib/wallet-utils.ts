/**
 * Wallet Utilities
 *
 * Helper functions for working with wallet transactions and zap payments
 */

import { NostrEvent } from "@/types/nostr";
import { getOrComputeCachedValue } from "applesauce-core/helpers";

export interface ZapRequestInfo {
  sender: string; // pubkey of the zapper
  message: string; // zap message content
  zappedEventId?: string; // ID of the zapped event (from e tag)
  zappedEventAddress?: string; // Address of the zapped event (from a tag)
  amount?: number; // amount in sats (if available)
}

// Symbol for caching parsed zap requests on transaction objects
const ZapRequestSymbol = Symbol("zapRequest");

/**
 * Try to parse a zap request from a transaction
 * Transaction descriptions for zaps contain a JSON-stringified kind 9734 event
 * Results are cached on the transaction object using applesauce pattern
 *
 * @param transaction - The transaction object with description field
 * @returns ZapRequestInfo if this is a zap payment, null otherwise
 */
export function parseZapRequest(transaction: {
  description?: string;
}): ZapRequestInfo | null {
  if (!transaction.description) return null;

  // Use applesauce caching pattern - cache result on transaction object
  return getOrComputeCachedValue(transaction, ZapRequestSymbol, () => {
    const description = transaction.description!;

    try {
      // Try to parse as JSON
      const parsed = JSON.parse(description);

      // Check if it's a valid zap request (kind 9734)
      if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.kind !== 9734 ||
        !parsed.pubkey ||
        typeof parsed.pubkey !== "string"
      ) {
        return null;
      }

      const event = parsed as NostrEvent;

      // Extract zapped event from tags
      let zappedEventId: string | undefined;
      let zappedEventAddress: string | undefined;

      if (Array.isArray(event.tags)) {
        // Look for e tag (event ID)
        const eTag = event.tags.find(
          (tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === "e",
        );
        if (eTag && typeof eTag[1] === "string") {
          zappedEventId = eTag[1];
        }

        // Look for a tag (address/coordinate)
        const aTag = event.tags.find(
          (tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === "a",
        );
        if (aTag && typeof aTag[1] === "string") {
          zappedEventAddress = aTag[1];
        }
      }

      return {
        sender: event.pubkey,
        message: event.content || "",
        zappedEventId,
        zappedEventAddress,
      };
    } catch {
      // Not JSON or parsing failed - not a zap request
      return null;
    }
  });
}
