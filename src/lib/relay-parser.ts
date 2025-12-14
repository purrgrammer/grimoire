import { normalizeRelayURL } from "./relay-url";

export interface ParsedRelayCommand {
  url: string;
}

/**
 * Parse RELAY command arguments
 *
 * Examples:
 *   relay wss://relay.damus.io
 *   relay relay.primal.net
 *   relay nos.lol
 */
export function parseRelayCommand(args: string[]): ParsedRelayCommand {
  if (args.length < 1) {
    throw new Error("Usage: RELAY <url>");
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

  // Normalize the URL (adds trailing slash, lowercases)
  return { url: normalizeRelayURL(url) };
}
