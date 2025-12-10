/**
 * Nostr validation utilities for hex strings and identifiers
 */

/**
 * Check if a string is a valid 64-character hex pubkey
 */
export function isValidHexPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

/**
 * Check if a string is a valid 64-character hex event ID
 */
export function isValidHexEventId(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

/**
 * Normalize hex string to lowercase
 */
export function normalizeHex(value: string): string {
  return value.toLowerCase();
}
