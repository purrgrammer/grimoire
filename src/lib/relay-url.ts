import { normalizeURL as applesauceNormalizeURL } from "applesauce-core/helpers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";

/**
 * Check if a string is a valid relay URL
 * - Must have ws:// or wss:// protocol
 * - Must be a valid URL structure
 * - Must have a valid hostname
 *
 * Uses applesauce's isSafeRelayURL for fast validation of domain-based URLs,
 * with a fallback to URL constructor for IP addresses (which isSafeRelayURL doesn't support).
 *
 * @returns true if the URL is a valid relay URL, false otherwise
 */
export function isValidRelayURL(url: unknown): url is string {
  // Must be a non-empty string
  if (typeof url !== "string" || !url.trim()) {
    return false;
  }

  const trimmed = url.trim();

  // Must start with ws:// or wss://
  if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
    return false;
  }

  // Fast path: use applesauce's regex-based validation for domain URLs
  if (isSafeRelayURL(trimmed)) {
    return true;
  }

  // Fallback: use URL constructor for IP addresses and edge cases
  // isSafeRelayURL doesn't support IP addresses like 192.168.1.1 or 127.0.0.1
  try {
    const parsed = new URL(trimmed);

    // Protocol must be ws: or wss:
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return false;
    }

    // Must have a valid hostname
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return false;
    }

    return true;
  } catch {
    // URL parsing failed
    return false;
  }
}

/**
 * Normalize a relay URL to ensure consistent comparison
 * - Validates input is a non-empty string
 * - Ensures wss:// protocol
 * - Ensures trailing slash
 * - Lowercases the URL
 *
 * Examples:
 * - "wss://relay.com" → "wss://relay.com/"
 * - "wss://relay.com/" → "wss://relay.com/"
 * - "relay.com" → "wss://relay.com/"
 *
 * @throws {TypeError} If url is not a string
 * @throws {Error} If url is empty or normalization fails
 */
export function normalizeRelayURL(url: string): string {
  // Input validation
  if (typeof url !== "string") {
    throw new TypeError(`Relay URL must be a string, received: ${typeof url}`);
  }

  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Relay URL cannot be empty");
  }

  try {
    // Ensure protocol
    let normalized = trimmed;
    if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
      normalized = `wss://${normalized}`;
    }

    // Use applesauce's normalization (adds trailing slash)
    normalized = applesauceNormalizeURL(normalized);

    // Lowercase for consistent comparison
    return normalized.toLowerCase();
  } catch (error) {
    throw new Error(
      `Failed to normalize relay URL "${url}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
