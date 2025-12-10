import { parseReqCommand } from "../lib/req-parser";
import type { AppId } from "./app";

import { parseOpenCommand } from "@/lib/open-parser";
import { parseProfileCommand } from "@/lib/profile-parser";
import { parseRelayCommand } from "@/lib/relay-parser";
import { resolveNip05Batch } from "@/lib/nip05";

export interface ManPageEntry {
  name: string;
  section: string;
  synopsis: string;
  description: string;
  options?: { flag: string; description: string }[];
  examples?: string[];
  seeAlso?: string[];
  // Command execution metadata
  appId: AppId;
  category: "Documentation" | "System" | "Nostr";
  argParser?: (args: string[]) => any;
  defaultProps?: any;
}

export const manPages: Record<string, ManPageEntry> = {
  nip: {
    name: "nip",
    section: "1",
    synopsis: "nip <number>",
    description:
      "View a Nostr Implementation Possibility (NIP) specification document. NIPs define the protocol standards and extensions for the Nostr network.",
    options: [
      {
        flag: "<number>",
        description: "The NIP number to view (e.g., 01, 02, 19)",
      },
    ],
    examples: [
      "nip 01    View the basic protocol specification",
      "nip 19    View the bech32 encoding specification",
    ],
    seeAlso: ["feed", "kind"],
    appId: "nip",
    category: "Documentation",
    argParser: (args: string[]) => {
      const num = args[0] || "01";
      // Pad single digit numbers with leading zero
      const paddedNum = num.length === 1 ? `0${num}` : num;
      return { number: paddedNum };
    },
    defaultProps: { number: "01" },
  },

  kind: {
    name: "kind",
    section: "1",
    synopsis: "kind <number>",
    description:
      "View information about a specific Nostr event kind. Event kinds define the type and purpose of Nostr events.",
    options: [
      {
        flag: "<number>",
        description: "The kind number to view (e.g., 0, 1, 3, 7)",
      },
    ],
    examples: [
      "kind 0    View metadata event kind",
      "kind 1    View short text note kind",
    ],
    seeAlso: ["nip"],
    appId: "kind",
    category: "Documentation",
    argParser: (args: string[]) => ({ number: args[0] || "1" }),
    defaultProps: { number: "1" },
  },
  help: {
    name: "help",
    section: "1",
    synopsis: "help",
    description:
      "Display general help information about Grimoire and available commands.",
    examples: [
      "Use man <command> to view detailed documentation",
      "Click any command to open its man page",
    ],
    seeAlso: ["man", "nip", "kind"],
    appId: "man",
    category: "System",
    defaultProps: { cmd: "help" },
  },
  man: {
    name: "man",
    section: "1",
    synopsis: "man <command>",
    description:
      "Display the manual page for a command. Man pages provide detailed documentation including usage, options, and examples.",
    options: [
      {
        flag: "<command>",
        description: "The command to view documentation for",
      },
    ],
    examples: [
      "man feed    View the feed command manual",
      "man nip     View the nip command manual",
    ],
    seeAlso: ["help"],
    appId: "man",
    category: "System",
    argParser: (args: string[]) => ({ cmd: args[0] || "help" }),
    defaultProps: { cmd: "help" },
  },
  req: {
    name: "req",
    section: "1",
    synopsis: "req [options] [relay...]",
    description:
      "Query Nostr relays using filters. Constructs and executes Nostr REQ messages to fetch events matching specified criteria. Supports filtering by kind, author, tags, time ranges, and content search.",
    options: [
      {
        flag: "-k, --kind <number>",
        description:
          "Filter by event kind (e.g., 0=metadata, 1=note, 7=reaction)",
      },
      {
        flag: "-a, --author <npub|hex|nip05>",
        description:
          "Filter by author pubkey (supports npub, hex, NIP-05 identifier, or bare domain)",
      },
      {
        flag: "-l, --limit <number>",
        description: "Maximum number of events to return",
      },
      {
        flag: "-e <id>",
        description: "Filter by referenced event ID (#e tag)",
      },
      {
        flag: "-p <npub|hex|nip05>",
        description:
          "Filter by mentioned pubkey (#p tag, supports npub, hex, NIP-05, or bare domain)",
      },
      {
        flag: "-t <hashtag>",
        description: "Filter by hashtag (#t tag)",
      },
      {
        flag: "-d <identifier>",
        description: "Filter by d-tag identifier (replaceable events)",
      },
      {
        flag: "--since <time>",
        description:
          "Events after timestamp (unix timestamp or relative: 1h, 30m, 7d)",
      },
      {
        flag: "--until <time>",
        description:
          "Events before timestamp (unix timestamp or relative: 1h, 30m, 7d)",
      },
      {
        flag: "--search <text>",
        description: "Search event content for text (relay-dependent)",
      },
      {
        flag: "--close-on-eose",
        description:
          "Close connection after EOSE (End Of Stored Events). By default, streams stay open for real-time updates.",
      },
      {
        flag: "[relay...]",
        description:
          "Relay URLs to query (wss://relay.com or shorthand: relay.com)",
      },
    ],
    examples: [
      "req -k 1 -l 20                      Get 20 recent notes (streams live by default)",
      "req -k 0 -a npub1...                 Get profile for author",
      "req -k 1 -a user@domain.com          Get notes from NIP-05 identifier",
      "req -k 1 -a dergigi.com              Get notes from bare domain (resolves to _@dergigi.com)",
      "req -k 1 -p verbiricha@habla.news    Get notes mentioning NIP-05 user",
      "req -k 1 --since 1h relay.damus.io   Get notes from last hour",
      "req -k 1 --close-on-eose             Get recent notes and close after EOSE",
      "req -t nostr -l 50                   Get 50 events tagged #nostr",
      "req --search bitcoin -k 1            Search notes for 'bitcoin'",
      "req -k 1 relay1.com relay2.com       Query multiple relays",
    ],
    seeAlso: ["kind", "nip"],
    appId: "req",
    category: "Nostr",
    argParser: async (args: string[]) => {
      const parsed = parseReqCommand(args);

      // Add default limit of 50 if not specified
      if (!parsed.filter.limit) {
        parsed.filter.limit = 50;
      }

      // Resolve NIP-05 identifiers if present
      const allNip05 = [
        ...(parsed.nip05Authors || []),
        ...(parsed.nip05PTags || []),
      ];

      if (allNip05.length > 0) {
        const resolved = await resolveNip05Batch(allNip05);

        // Add resolved authors to filter
        if (parsed.nip05Authors) {
          for (const nip05 of parsed.nip05Authors) {
            const pubkey = resolved.get(nip05);
            if (pubkey) {
              if (!parsed.filter.authors) parsed.filter.authors = [];
              parsed.filter.authors.push(pubkey);
            }
          }
        }

        // Add resolved #p tags to filter
        if (parsed.nip05PTags) {
          for (const nip05 of parsed.nip05PTags) {
            const pubkey = resolved.get(nip05);
            if (pubkey) {
              if (!parsed.filter["#p"]) parsed.filter["#p"] = [];
              parsed.filter["#p"].push(pubkey);
            }
          }
        }
      }

      return parsed;
    },
    defaultProps: { filter: { kinds: [1], limit: 50 } },
  },
  open: {
    name: "open",
    section: "1",
    synopsis: "open <identifier>",
    description:
      "Open a detailed view of a Nostr event. Accepts multiple identifier formats including bech32-encoded IDs, hex IDs, and address pointers. Displays event metadata, rendered content, and raw JSON.",
    options: [
      {
        flag: "<identifier>",
        description: "Event identifier in any supported format (see examples)",
      },
    ],
    examples: [
      "open note1abc...                      Open event by note1 ID",
      "open nevent1xyz...                    Open event with relay hints",
      "open naddr1def...                     Open addressable event",
      "open abc123...                        Open event by hex ID (64 chars)",
      "open 30023:abc123...:my-article       Open by address pointer (kind:pubkey:d-tag)",
    ],
    seeAlso: ["req", "kind"],
    appId: "open",
    category: "Nostr",
    argParser: (args: string[]) => {
      const parsed = parseOpenCommand(args);
      return parsed;
    },
  },
  profile: {
    name: "profile",
    section: "1",
    synopsis: "profile <identifier>",
    description:
      "Open a detailed view of a Nostr user profile. Accepts multiple identifier formats including npub, nprofile, hex pubkeys, and NIP-05 identifiers (including bare domains). Displays profile metadata, inbox/outbox relays, and raw JSON.",
    options: [
      {
        flag: "<identifier>",
        description: "User identifier in any supported format (see examples)",
      },
    ],
    examples: [
      "profile npub1abc...                   Open profile by npub",
      "profile nprofile1xyz...               Open profile with relay hints",
      "profile abc123...                     Open profile by hex pubkey (64 chars)",
      "profile user@domain.com               Open profile by NIP-05 identifier",
      "profile jack@cash.app                 Open profile using NIP-05",
      "profile dergigi.com                   Open profile by domain (resolves to _@dergigi.com)",
    ],
    seeAlso: ["open", "req"],
    appId: "profile",
    category: "Nostr",
    argParser: async (args: string[]) => {
      const parsed = await parseProfileCommand(args);
      return parsed;
    },
  },
  encode: {
    name: "encode",
    section: "1",
    synopsis: "encode <type> <value> [--relay <url>] [--author <pubkey>]",
    description:
      "Encode hex values into Nostr bech32 identifiers (npub, note, nevent, nprofile, naddr). Follows nak-style syntax for explicit, unambiguous encoding.",
    options: [
      {
        flag: "<type>",
        description: "Encoding type: npub, note, nevent, nprofile, naddr",
      },
      {
        flag: "<value>",
        description:
          "Hex value to encode (pubkey, event ID, or kind:pubkey:d-tag)",
      },
      {
        flag: "--relay, -r",
        description: "Add relay hint (can be specified multiple times)",
      },
      {
        flag: "--author, -a",
        description: "Add author pubkey (nevent only)",
      },
    ],
    examples: [
      "encode npub abc123...                 Encode pubkey to npub",
      "encode nprofile abc123... --relay wss://relay.example.com",
      "encode note def456...                 Encode event ID to note",
      "encode nevent def456... --relay wss://relay.example.com --author abc123...",
      "encode naddr 30023:abc123...:article --relay wss://relay.example.com",
    ],
    seeAlso: ["decode"],
    appId: "encode",
    category: "Nostr",
    argParser: (args: string[]) => {
      return { args };
    },
  },
  decode: {
    name: "decode",
    section: "1",
    synopsis: "decode <bech32-identifier>",
    description:
      "Decode Nostr bech32 identifiers (npub, note, nevent, nprofile, naddr, nsec) into their component parts. Display decoded data, edit relay hints, re-encode with updates, and open events or profiles directly.",
    options: [
      {
        flag: "<bech32-identifier>",
        description: "Any Nostr bech32 identifier to decode",
      },
    ],
    examples: [
      "decode npub1abc...                    Decode npub to hex pubkey",
      "decode nevent1xyz...                  Decode nevent showing ID, relays, author",
      "decode naddr1def...                   Decode naddr showing kind, pubkey, identifier",
      "decode nprofile1ghi...                Decode nprofile with relay hints",
    ],
    seeAlso: ["encode"],
    appId: "decode",
    category: "Nostr",
    argParser: (args: string[]) => {
      return { args };
    },
  },
  relay: {
    name: "relay",
    section: "1",
    synopsis: "relay <url>",
    description:
      "View detailed information about a Nostr relay. Displays NIP-11 relay information document including connection status, supported NIPs, operator details, limitations, and software information.",
    options: [
      {
        flag: "<url>",
        description:
          "Relay WebSocket URL (wss:// or ws://) or domain (auto-adds wss://)",
      },
    ],
    examples: [
      "relay wss://relay.damus.io           View relay information",
      "relay relay.primal.net               Auto-adds wss:// protocol",
      "relay nos.lol                        View relay capabilities",
    ],
    seeAlso: ["req", "profile"],
    appId: "relay",
    category: "Nostr",
    argParser: (args: string[]) => {
      const parsed = parseRelayCommand(args);
      return parsed;
    },
  },
};
