/**
 * Nostr event kind range constants and utilities
 *
 * Re-exports from nostr-tools where available, with additional
 * Grimoire-specific utilities.
 *
 * Based on NIP-01 specification:
 * - Regular kinds: 0-9999 (non-replaceable, except 0 and 3)
 * - Replaceable kinds: 0, 3, 10000-19999 (replaced by newer)
 * - Ephemeral kinds: 20000-29999 (not stored)
 * - Parameterized replaceable: 30000-39999 (replaced by kind+pubkey+d-tag)
 */

// Re-export from nostr-tools for consistency
export {
  isRegularKind,
  isReplaceableKind,
  isEphemeralKind,
  classifyKind,
} from "nostr-tools/kinds";

// Import for internal use
import {
  isReplaceableKind as _isReplaceableKind,
  isEphemeralKind as _isEphemeralKind,
} from "nostr-tools/kinds";

// Kind range boundaries (NIP-01) - exported for display purposes only
export const REGULAR_START = 0;
export const REGULAR_END = 10000;
export const REPLACEABLE_START = 10000;
export const REPLACEABLE_END = 20000;
export const EPHEMERAL_START = 20000;
export const EPHEMERAL_END = 30000;
export const PARAMETERIZED_REPLACEABLE_START = 30000;
export const PARAMETERIZED_REPLACEABLE_END = 40000;

/**
 * Check if a kind is parameterized replaceable (NIP-01)
 * Kinds 30000-39999 are replaced by newer events from same pubkey with same d-tag
 *
 * Note: nostr-tools calls this "addressable" but we use "parameterized replaceable"
 * for consistency with NIP-01 terminology
 */
export function isParameterizedReplaceableKind(kind: number): boolean {
  return kind >= PARAMETERIZED_REPLACEABLE_START && kind < PARAMETERIZED_REPLACEABLE_END;
}

/**
 * Check if a kind should use naddr/AddressPointer instead of nevent/EventPointer
 *
 * This includes both:
 * - Replaceable kinds (0, 3, 10000-19999) - identified by pubkey+kind
 * - Parameterized replaceable kinds (30000-39999) - identified by pubkey+kind+d-tag
 *
 * Use this to determine how to encode event references (naddr vs nevent)
 */
export function isAddressableKind(kind: number): boolean {
  return _isReplaceableKind(kind) || isParameterizedReplaceableKind(kind);
}

/**
 * Get the category of a kind for display purposes
 */
export function getKindCategory(kind: number): 'regular' | 'replaceable' | 'ephemeral' | 'parameterized_replaceable' {
  if (_isReplaceableKind(kind)) return 'replaceable';
  if (_isEphemeralKind(kind)) return 'ephemeral';
  if (isParameterizedReplaceableKind(kind)) return 'parameterized_replaceable';
  return 'regular';
}
