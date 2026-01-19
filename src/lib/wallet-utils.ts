/**
 * Wallet Utilities
 *
 * Helper functions for working with wallet transactions and zap payments
 */

import { NostrEvent } from "@/types/nostr";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { decode as decodeBolt11 } from "light-bolt11-decoder";

export interface ZapRequestInfo {
  sender: string; // pubkey of the zapper
  message: string; // zap message content
  zappedEventId?: string; // ID of the zapped event (from e tag)
  zappedEventAddress?: string; // Address of the zapped event (from a tag)
  amount?: number; // amount in sats (if available)
  zapRequestEvent: NostrEvent; // The full kind 9734 zap request event
}

// Symbol for caching parsed zap requests on transaction objects
const ZapRequestSymbol = Symbol("zapRequest");

/**
 * Try to parse a zap request JSON string into a ZapRequestInfo object
 * @param jsonString - The JSON string to parse
 * @returns ZapRequestInfo if valid zap request, null otherwise
 */
function tryParseZapRequestJson(jsonString: string): ZapRequestInfo | null {
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(jsonString);

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
      zapRequestEvent: event,
    };
  } catch {
    // Not JSON or parsing failed - not a zap request
    return null;
  }
}

/**
 * Try to parse a zap request from a transaction
 * Checks both the transaction description and the invoice description
 * Transaction descriptions for zaps contain a JSON-stringified kind 9734 event
 * Results are cached on the transaction object using applesauce pattern
 *
 * @param transaction - The transaction object with description and/or invoice field
 * @returns ZapRequestInfo if this is a zap payment, null otherwise
 */
export function parseZapRequest(transaction: {
  description?: string;
  invoice?: string;
}): ZapRequestInfo | null {
  // Use applesauce caching pattern - cache result on transaction object
  return getOrComputeCachedValue(transaction, ZapRequestSymbol, () => {
    // Try parsing the transaction description first
    if (transaction.description) {
      const result = tryParseZapRequestJson(transaction.description);
      if (result) return result;
    }

    // If that didn't work, try decoding the invoice and checking its description
    if (transaction.invoice) {
      try {
        const decoded = decodeBolt11(transaction.invoice);
        const descSection = decoded.sections.find(
          (s) => s.name === "description",
        );

        if (descSection && descSection.value) {
          const result = tryParseZapRequestJson(descSection.value as string);
          if (result) return result;
        }
      } catch {
        // Invoice decoding failed, ignore
      }
    }

    return null;
  });
}

// Symbol for caching invoice description on transaction objects
const InvoiceDescriptionSymbol = Symbol("invoiceDescription");

/**
 * Extract the description from a BOLT11 invoice
 * Results are cached on the transaction object using applesauce pattern
 *
 * @param transaction - The transaction object with invoice field
 * @returns The invoice description string, or undefined if not available
 */
export function getInvoiceDescription(transaction: {
  invoice?: string;
}): string | undefined {
  // Use applesauce caching pattern - cache result on transaction object
  return getOrComputeCachedValue(transaction, InvoiceDescriptionSymbol, () => {
    if (!transaction.invoice) return undefined;

    try {
      const decoded = decodeBolt11(transaction.invoice);
      const descSection = decoded.sections.find(
        (s) => s.name === "description",
      );

      if (descSection && "value" in descSection) {
        return String(descSection.value);
      }
    } catch {
      // Invoice decoding failed, ignore
    }

    return undefined;
  });
}
