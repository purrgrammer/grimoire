/**
 * Parser for RELAY ADMIN command
 *
 * Usage: relay admin <url>
 *
 * Examples:
 *   relay admin wss://relay.damus.io
 *   relay admin relay.primal.net
 */

import { normalizeRelayURL } from "./relay-url";

export interface ParsedRelayAdminCommand {
  url: string;
}

/**
 * Parse RELAY ADMIN command arguments
 *
 * @param args - Command arguments (URL only)
 * @returns Parsed command with normalized relay URL
 * @throws Error if URL is missing or invalid
 */
export function parseRelayAdminCommand(
  args: string[],
): ParsedRelayAdminCommand {
  if (args.length < 1) {
    throw new Error("Usage: relay admin <url>");
  }

  let url = args[0];

  // Auto-add wss:// protocol if not present
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    url = `wss://${url}`;
  }

  // Validate URL format
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.protocol.startsWith("ws")) {
      throw new Error("Relay must be a WebSocket URL (ws:// or wss://)");
    }
  } catch {
    throw new Error(`Invalid relay URL: ${url}`);
  }

  return { url: normalizeRelayURL(url) };
}
