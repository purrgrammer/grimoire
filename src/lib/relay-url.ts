import { normalizeURL as applesauceNormalizeURL } from "applesauce-core/helpers";

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
