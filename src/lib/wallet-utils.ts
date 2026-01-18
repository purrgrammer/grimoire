/**
 * Wallet Utilities
 *
 * Helper functions for working with wallet transactions and zap payments
 */

import { NostrEvent } from "@/types/nostr";

export interface ZapRequestInfo {
  sender: string; // pubkey of the zapper
  message: string; // zap message content
  zappedEventId?: string; // ID of the zapped event (from e tag)
  zappedEventAddress?: string; // Address of the zapped event (from a tag)
  amount?: number; // amount in sats (if available)
}

// Cache for parsed zap requests (keyed by description string)
// Use Map with size limit to prevent unbounded growth
const zapRequestCache = new Map<string, ZapRequestInfo | null>();
const MAX_CACHE_SIZE = 500;

/**
 * Try to parse a zap request from a transaction description
 * Transaction descriptions for zaps contain a JSON-stringified kind 9734 event
 * Results are cached to avoid re-parsing the same descriptions
 *
 * @param description - The transaction description field
 * @returns ZapRequestInfo if this is a zap payment, null otherwise
 */
export function parseZapRequest(description?: string): ZapRequestInfo | null {
  if (!description) return null;

  // Check cache first
  if (zapRequestCache.has(description)) {
    return zapRequestCache.get(description)!;
  }

  let result: ZapRequestInfo | null = null;

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
      result = null;
    } else {
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

      result = {
        sender: event.pubkey,
        message: event.content || "",
        zappedEventId,
        zappedEventAddress,
      };
    }
  } catch {
    // Not JSON or parsing failed - not a zap request
    result = null;
  }

  // Cache the result (with size limit to prevent unbounded growth)
  if (zapRequestCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first key in the map)
    const firstKey = zapRequestCache.keys().next().value;
    if (firstKey) {
      zapRequestCache.delete(firstKey);
    }
  }
  zapRequestCache.set(description, result);

  return result;
}

/**
 * Get a short preview of a zap message for display in lists
 * Truncates to maxLength characters and removes line breaks
 *
 * @param message - The full zap message
 * @param maxLength - Maximum length before truncation (default 50)
 * @returns Truncated message with ellipsis if needed
 */
export function getZapMessagePreview(
  message: string,
  maxLength: number = 50,
): string {
  if (!message) return "";

  // Remove line breaks and extra whitespace
  const cleaned = message.replace(/\s+/g, " ").trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return cleaned.substring(0, maxLength - 1) + "…";
}
