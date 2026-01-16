import { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

/**
 * P2P Order Helper Functions
 */

/**
 * Status of the order
 */
export const ORDER_STATUSES = [
  "pending",
  "canceled",
  "in-progress",
  "success",
  "expired",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Get all values for a tag name (plural version of getTagValue)
 * Unlike getTagValue which returns first match, this returns all matches
 */
function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName)
    .flatMap((tag) => tag.slice(1));
}

// ============================================================================
// Kind 38383 (P2P Orders) Helpers
// ============================================================================

/**
 * Get order type from k tag (sell or buy)
 */
export function getOrderType(event: NostrEvent): string | undefined {
  if (event.kind !== 38383) return undefined;
  return getTagValue(event, "k");
}

/**
 * Get amount in fiat from fa tag
 */
export function getFiatAmount(
  event: NostrEvent,
): (string | undefined)[] | undefined {
  if (event.kind !== 38383) return undefined;
  const values = getTagValues(event, "fa");

  return values.map((monto) => {
    const number = parseFloat(monto);

    if (Number.isNaN(number)) return undefined;

    return number < 1 ? number.toString() : parseInt(monto, 10).toString();
  });
}

/**
 * Get amount in sats from amt tag
 */
export function getSatsAmount(event: NostrEvent): number | undefined {
  if (event.kind !== 38383) return undefined;
  const value = getTagValue(event, "amt");

  if (!value) return undefined;

  const number = parseInt(value, 10);

  if (Number.isNaN(number)) return undefined;

  return number;
}

/**
 * Get currency code using the ISO 4217 standard.
 */
export function getCurrency(event: NostrEvent): string | undefined {
  if (event.kind !== 38383) return undefined;

  return getTagValue(event, "f");
}

/**
 * Get the bitcoin network
 */
export function getBitcoinNetwork(event: NostrEvent): string | undefined {
  if (event.kind !== 38383) return undefined;

  return getTagValue(event, "network");
}

/**
 * Get the user name
 */
export function getUsername(event: NostrEvent): string | undefined {
  if (event.kind !== 38383) return undefined;

  return getTagValue(event, "name");
}

/**
 * Get accepted payment methods
 */
export function getPaymentMethods(event: NostrEvent): string[] | undefined {
  if (event.kind !== 38383) return undefined;

  return getTagValues(event, "pm");
}

/**
 * Get platform where the order is hosted
 */
export function getPlatform(event: NostrEvent): string | undefined {
  if (event.kind !== 38383) return undefined;

  return getTagValue(event, "y");
}

/**
 * Get rating
 */
export function getExpiration(event: NostrEvent): number | undefined {
  if (event.kind !== 38383) return undefined;

  const value = getTagValue(event, "expiration");

  if (!value) return undefined;

  const number = parseInt(value, 10);

  if (Number.isNaN(number)) return undefined;

  return number;
}

/**
 * Get premium value over market price
 */
export function getPremium(event: NostrEvent): number | undefined {
  if (event.kind !== 38383) return undefined;
  const value = getTagValue(event, "premium");

  if (!value) return undefined;

  const number = parseInt(value, 10);

  if (Number.isNaN(number)) return undefined;

  return number;
}

/**
 * Get status of the order
 */
export function getOrderStatus(event: NostrEvent): OrderStatus | undefined {
  if (event.kind !== 38383) return undefined;

  const status = getTagValue(event, "s");

  if (!status) return undefined;

  if (!ORDER_STATUSES.includes(status as OrderStatus)) return undefined;

  return status as OrderStatus;
}

/**
 * Get link to the order view in host
 */
export function getSource(event: NostrEvent): string | undefined {
  if (event.kind !== 38383) return undefined;

  return getTagValue(event, "source");
}

/**
 * Get bitcoin layer
 */
export function getBitcoinLayer(event: NostrEvent): string | undefined {
  if (event.kind !== 38383) return undefined;

  return getTagValue(event, "layer");
}
