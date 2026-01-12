import type { ChatCommandResult } from "@/types/chat";
// import { NipC7Adapter } from "./chat/adapters/nip-c7-adapter";
import { Nip29Adapter } from "./chat/adapters/nip-29-adapter";
import { Nip53Adapter } from "./chat/adapters/nip-53-adapter";
// Import other adapters as they're implemented
// import { Nip17Adapter } from "./chat/adapters/nip-17-adapter";
// import { Nip28Adapter } from "./chat/adapters/nip-28-adapter";

/**
 * Parse a chat command identifier and auto-detect the protocol
 *
 * Tries each adapter's parseIdentifier() in priority order:
 * 1. NIP-17 (encrypted DMs) - prioritized for privacy
 * 2. NIP-28 (channels) - specific event format (kind 40)
 * 3. NIP-29 (groups) - specific group ID format
 * 4. NIP-53 (live chat) - specific addressable format (kind 30311)
 * 5. NIP-C7 (simple chat) - fallback for generic pubkeys
 *
 * @param args - Command arguments (first arg is the identifier)
 * @returns Parsed result with protocol and identifier
 * @throws Error if no adapter can parse the identifier
 */
export function parseChatCommand(args: string[]): ChatCommandResult {
  if (args.length === 0) {
    throw new Error("Chat identifier required. Usage: chat <identifier>");
  }

  // Handle NIP-29 format that may be split by shell-quote
  // If we have 2 args and they look like relay + group-id, join them with '
  let identifier = args[0];
  if (args.length === 2 && args[0].includes(".") && !args[0].includes("'")) {
    // Looks like "relay.com" "group-id" split by shell-quote
    // Rejoin with apostrophe for NIP-29 format
    identifier = `${args[0]}'${args[1]}`;
  }

  // Try each adapter in priority order
  const adapters = [
    // new Nip17Adapter(),  // Phase 2
    // new Nip28Adapter(),  // Phase 3
    new Nip29Adapter(), // Phase 4 - Relay groups
    new Nip53Adapter(), // Phase 5 - Live activity chat
    // new NipC7Adapter(), // Phase 1 - Simple chat (disabled for now)
  ];

  for (const adapter of adapters) {
    const parsed = adapter.parseIdentifier(identifier);
    if (parsed) {
      return {
        protocol: adapter.protocol,
        identifier: parsed,
        adapter,
      };
    }
  }

  throw new Error(
    `Unable to determine chat protocol from identifier: ${identifier}

Currently supported formats:
  - relay.com'group-id (NIP-29 relay group, wss:// prefix optional)
    Examples:
      chat relay.example.com'bitcoin-dev
      chat wss://relay.example.com'nostr-dev
  - naddr1... (NIP-29 group metadata, kind 39000)
    Example:
      chat naddr1qqxnzdesxqmnxvpexqmny...
  - naddr1... (NIP-53 live activity chat, kind 30311)
    Example:
      chat naddr1... (live stream address)

More formats coming soon:
  - npub/nprofile/hex pubkey (NIP-C7/NIP-17 direct messages)
  - note/nevent (NIP-28 public channels)`,
  );
}
