import type { ChatCommandResult, ChatProtocol } from "@/types/chat";
// import { NipC7Adapter } from "./chat/adapters/nip-c7-adapter";
import { Nip17Adapter } from "./chat/adapters/nip-17-adapter";
import { Nip29Adapter } from "./chat/adapters/nip-29-adapter";
import { Nip53Adapter } from "./chat/adapters/nip-53-adapter";
// Import other adapters as they're implemented
// import { Nip28Adapter } from "./chat/adapters/nip-28-adapter";

/**
 * Protocols that support conversation list view
 */
const LISTABLE_PROTOCOLS: ChatProtocol[] = ["nip-17"];

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
 * Special case: `chat nip-17` shows conversation list
 *
 * @param args - Command arguments (first arg is the identifier)
 * @returns Parsed result with protocol and identifier
 * @throws Error if no adapter can parse the identifier
 */
export function parseChatCommand(args: string[]): ChatCommandResult {
  if (args.length === 0) {
    throw new Error("Chat identifier required. Usage: chat <identifier>");
  }

  // Check for conversation list mode: `chat nip-17`
  const protocolArg = args[0].toLowerCase();
  if (LISTABLE_PROTOCOLS.includes(protocolArg as ChatProtocol)) {
    return {
      protocol: protocolArg as ChatProtocol,
      identifier: {
        type: "conversation-list",
        protocol: protocolArg as ChatProtocol,
      },
      adapter: protocolArg === "nip-17" ? new Nip17Adapter() : null,
    };
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
    // new Nip28Adapter(),  // Phase 3
    new Nip29Adapter(), // Relay groups (NIP-29)
    new Nip53Adapter(), // Live activity chat (NIP-53)
    new Nip17Adapter(), // Encrypted DMs (NIP-17) - checked after group/live formats
    // new NipC7Adapter(), // Simple chat (disabled - NIP-17 preferred)
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

Supported formats:
  - nip-17 (show all encrypted DM conversations)
  - npub1... / nprofile1... (NIP-17 encrypted DM)
  - hex pubkey (NIP-17 encrypted DM)
  - user@domain.com (NIP-05 → NIP-17 encrypted DM)
  - relay.com'group-id (NIP-29 relay group)
  - naddr1... kind 39000 (NIP-29 group metadata)
  - naddr1... kind 30311 (NIP-53 live activity chat)

Examples:
  chat nip-17                      # List all DM conversations
  chat npub1abc123...              # DM with user
  chat alice@example.com           # DM via NIP-05
  chat relay.example.com'bitcoin   # Join relay group
  chat naddr1...                   # Live stream chat`,
  );
}
