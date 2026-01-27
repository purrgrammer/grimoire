import { parseReqCommand } from "../lib/req-parser";
import { parseCountCommand } from "../lib/count-parser";
import type { AppId } from "./app";

import { parseOpenCommand } from "@/lib/open-parser";
import { parseProfileCommand } from "@/lib/profile-parser";
import { parseRelayCommand } from "@/lib/relay-parser";
import { resolveNip05Batch, resolveDomainDirectoryBatch } from "@/lib/nip05";
import { parseChatCommand } from "@/lib/chat-parser";
import { parseBlossomCommand } from "@/lib/blossom-parser";
import { parseZapCommand } from "@/lib/zap-parser";

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
  argParser?: (args: string[], activeAccountPubkey?: string) => any;
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
        description: "The NIP number to view (e.g., 01, 02, 19, B0)",
      },
    ],
    examples: [
      "nip 01    View the basic protocol specification",
      "nip 19    View the bech32 encoding specification",
      "nip b0    View the NIP-B0 specification",
    ],
    seeAlso: ["nips", "kind", "kinds"],
    appId: "nip",
    category: "Documentation",
    argParser: (args: string[]) => {
      const num = (args[0] || "01").toUpperCase();
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
    seeAlso: ["kinds", "nip", "nips"],
    appId: "kind",
    category: "Documentation",
    argParser: (args: string[]) => ({ number: args[0] || "1" }),
    defaultProps: { number: "1" },
  },
  spellbooks: {
    name: "spellbooks",
    section: "1",
    synopsis: "spellbooks",
    description: "Browse and manage saved layout spellbooks.",
    appId: "spellbooks",
    category: "System",
  },
  help: {
    name: "help",
    section: "1",
    synopsis: "help",
    description:
      "Display general help information about Grimoire and available commands.",
    seeAlso: ["man", "nip", "kind"],
    appId: "man",
    category: "System",
    defaultProps: { cmd: "help" },
  },
  kinds: {
    name: "kinds",
    section: "1",
    synopsis: "kinds",
    description:
      "Display all Nostr event kinds with rich rendering support in Grimoire. Shows kind numbers, names, descriptions, and links to their defining NIPs.",
    examples: ["kinds    View all supported event kinds"],
    seeAlso: ["kind", "nip", "man"],
    appId: "kinds",
    category: "System",
    defaultProps: {},
  },
  nips: {
    name: "nips",
    section: "1",
    synopsis: "nips",
    description:
      "Display all Nostr Implementation Possibilities (NIPs). Shows NIP numbers and titles, with links to view each specification document.",
    examples: ["nips    View all NIPs"],
    seeAlso: ["nip", "kinds", "man"],
    appId: "nips",
    category: "Documentation",
    defaultProps: {},
  },
  debug: {
    name: "debug",
    section: "1",
    synopsis: "debug",
    description:
      "Display the current application state for debugging purposes. Shows windows, workspaces, active account, and other internal state in a formatted view.",
    examples: ["debug    View current application state"],
    seeAlso: ["help"],
    appId: "debug",
    category: "System",
    defaultProps: {},
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
      "man req     View the req command manual",
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
      "Query Nostr relays using filters. Constructs and executes Nostr REQ messages to fetch events matching specified criteria. Supports filtering by kind, author, tags, time ranges, and content search. Use $me and $contacts aliases for queries based on your active account.",
    options: [
      {
        flag: "-k, --kind <number>",
        description:
          "Filter by event kind (e.g., 0=metadata, 1=note, 7=reaction). Supports comma-separated values: -k 1,3,7",
      },
      {
        flag: "-a, --author <npub|hex|nip05|$me|$contacts>",
        description:
          "Filter by author pubkey (supports npub, hex, NIP-05 identifier, bare domain, $me, or $contacts). Supports comma-separated values: -a npub1...,user@domain.com,$me",
      },
      {
        flag: "-l, --limit <number>",
        description: "Maximum number of events to return",
      },
      {
        flag: "-i, --id <note|nevent|hex>",
        description:
          "Direct event lookup by ID (filter.ids). Fetch specific events by their ID. Supports note1, nevent1 (with relay hints), or raw hex. Comma-separated values supported: -i note1...,nevent1...,abc123...",
      },
      {
        flag: "-e <note|nevent|naddr|coordinate|hex>",
        description:
          "Tag-based filtering (#e/#a tags). Find events that reference the specified events or addresses. Supports note1, nevent1, naddr1, raw coordinates (kind:pubkey:d-tag), or hex. Comma-separated values supported: -e note1...,30023:pubkey:article",
      },
      {
        flag: "-p <npub|hex|nip05|$me|$contacts>",
        description:
          "Filter by mentioned pubkey (#p tag, supports npub, hex, NIP-05, bare domain, $me, or $contacts). Supports comma-separated values: -p npub1...,npub2...,$contacts",
      },
      {
        flag: "-P <npub|hex|nip05|$me|$contacts>",
        description:
          "Filter by zap sender (#P tag, supports npub, hex, NIP-05, bare domain, $me, or $contacts). Supports comma-separated values: -P npub1...,npub2...,$me. Useful for finding zaps sent by specific users.",
      },
      {
        flag: "-t <hashtag>",
        description:
          "Filter by hashtag (#t tag). Supports comma-separated values: -t nostr,bitcoin,lightning",
      },
      {
        flag: "-d <identifier>",
        description:
          "Filter by d-tag identifier (replaceable events). Supports comma-separated values: -d article1,article2",
      },
      {
        flag: "-T, --tag <letter> <value>",
        description:
          "Filter by any single-letter tag (#<letter>). Supports comma-separated values: --tag a val1,val2. Works with any tag (a, r, g, L, etc.)",
      },
      {
        flag: "--since <time>",
        description:
          "Events after timestamp (unix timestamp, relative: 30s, 1m, 2h, 7d, 2w, 3mo, 1y, or 'now')",
      },
      {
        flag: "--until <time>",
        description:
          "Events before timestamp (unix timestamp, relative: 30s, 1m, 2h, 7d, 2w, 3mo, 1y, or 'now')",
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
        flag: "-v, --view <list|compact>",
        description:
          "Display mode for results. 'list' shows full event cards, 'compact' shows condensed single-line rows. Defaults to 'list'.",
      },
      {
        flag: "-f, --follow",
        description:
          "Auto-refresh mode (like tail -f). Automatically displays new events instead of buffering them behind a 'X new events' button. Refreshes every second.",
      },
      {
        flag: "[relay...]",
        description:
          "Relay URLs to query (wss://relay.com or shorthand: relay.com)",
      },
    ],
    examples: [
      "req -k 1 -l 20                       							    Get 20 recent notes (auto-selects optimal relays via NIP-65)",
      "req -k 1,3,7 -l 50                   							    Get notes, contact lists, and reactions",
      "req -k 0 -a fiatjaf.com                                                                      Get profile (queries author's outbox relays)",
      "req -k 1 -a fiatjaf.com 							            Get notes from NIP-05 identifier",
      "req -k 1 -a dergigi.com                                                                      Get notes from bare domain (resolves to _@dergigi.com)",
      "req -k 1 -a fiatjaf.com,dergigi.com                                                          Get notes from multiple authors (balances across outbox relays)",
      "req -a $me                                                                                   Get all your events (queries your outbox relays)",
      "req -k 1 -a $contacts --since 24h                                                            Get notes from contacts (queries their outbox relays)",
      "req -k 1 -a $contacts --since 7d                                                             Get notes from contacts in last week",
      "req -k 1 -a $contacts --since 3mo                                                            Get notes from contacts in last 3 months",
      "req -k 1 -a $contacts --since 1y                                                             Get notes from contacts in last year",
      "req -p $me -k 1,7                                                                            Get replies and reactions to you (queries your inbox relays)",
      "req -k 1 -a $me -a $contacts                                                                 Get notes from you and contacts",
      "req -k 9735 -p $me --since 7d                                                                Get zaps you received (queries your inbox)",
      "req -k 9735 -P $me --since 7d                                                                Get zaps you sent",
      "req -k 9735 -P $contacts                                                                     Get zaps sent by your contacts",
      "req -k 1 -p fiatjaf.com                                                                       Get notes mentioning user (queries their inbox)",
      "req -k 1 --since 1h relay.damus.io                                                           Get notes from last hour (manual relay override)",
      "req -k 1 --since 7d --until now                                                              Get notes from last week up to now",
      "req -k 1 --close-on-eose                                                                     Get recent notes and close after EOSE",
      "req -i note1abc123...                                                                        Direct lookup: fetch event by ID",
      "req -i nevent1...                                                                            Direct lookup: fetch event by nevent (uses relay hints)",
      "req -e note1abc123... -k 1                                                                   Tag filtering: find notes that reply to or reference event",
      "req -e 30023:pubkey...:article-name -k 1,7                                                   Tag filtering: find events referencing addressable event",
      "req -t nostr,grimoire,bitcoin -l 50                                                          Get 50 events tagged #nostr, #grimoire, or #bitcoin",
      "req --tag a 30023:7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194:grimoire  Get events referencing addressable event (#a tag)",
      "req -T r grimoire.rocks              							    Get events referencing URL (#r tag)",
      "req -k 30023 --tag d badges,grimoire 							    Get specific replaceable events by d-tag",
      "req --search bitcoin -k 1            							    Search notes for 'bitcoin'",
      "req -k 1 theforest.nostr1.com relay.damus.io                                                 Query specific relays (overrides auto-selection)",
      "req -k 1 -l 100 --view compact                                                                 Get notes in compact view mode",
      "req -k 1 -f                                                                                    Follow mode: auto-display new notes (1s refresh)",
      "req -k 1 -a $contacts -f                                                                       Follow your contacts' notes in real-time",
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
        ...(parsed.nip05PTagsUppercase || []),
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

        // Add resolved #P tags to filter
        if (parsed.nip05PTagsUppercase) {
          for (const nip05 of parsed.nip05PTagsUppercase) {
            const pubkey = resolved.get(nip05);
            if (pubkey) {
              if (!parsed.filter["#P"]) parsed.filter["#P"] = [];
              parsed.filter["#P"].push(pubkey);
            }
          }
        }
      }

      // Resolve domain directories if present
      const allDomains = [
        ...(parsed.domainAuthors || []),
        ...(parsed.domainPTags || []),
        ...(parsed.domainPTagsUppercase || []),
      ];

      if (allDomains.length > 0) {
        const resolved = await resolveDomainDirectoryBatch(allDomains);

        // Add resolved authors to filter
        if (parsed.domainAuthors) {
          for (const domain of parsed.domainAuthors) {
            const pubkeys = resolved.get(domain);
            if (pubkeys) {
              if (!parsed.filter.authors) parsed.filter.authors = [];
              parsed.filter.authors.push(...pubkeys);
            }
          }
        }

        // Add resolved #p tags to filter
        if (parsed.domainPTags) {
          for (const domain of parsed.domainPTags) {
            const pubkeys = resolved.get(domain);
            if (pubkeys) {
              if (!parsed.filter["#p"]) parsed.filter["#p"] = [];
              parsed.filter["#p"].push(...pubkeys);
            }
          }
        }

        // Add resolved #P tags to filter
        if (parsed.domainPTagsUppercase) {
          for (const domain of parsed.domainPTagsUppercase) {
            const pubkeys = resolved.get(domain);
            if (pubkeys) {
              if (!parsed.filter["#P"]) parsed.filter["#P"] = [];
              parsed.filter["#P"].push(...pubkeys);
            }
          }
        }
      }

      return parsed;
    },
    defaultProps: { filter: { kinds: [1], limit: 50 } },
  },
  count: {
    name: "count",
    section: "1",
    synopsis: "count <relay...> [options]",
    description:
      "Count events on Nostr relays using the NIP-45 COUNT verb. Returns event counts matching specified filter criteria. Requires at least one relay. Checks NIP-11 relay info to detect NIP-45 support before querying. Can be saved as a spell for quick access.",
    options: [
      {
        flag: "<relay...>",
        description:
          "Relay URLs to query (required). At least one relay must be specified. Can appear anywhere in the command. Supports wss://relay.com or shorthand: relay.com",
      },
      {
        flag: "-k, --kind <number>",
        description:
          "Filter by event kind (e.g., 0=metadata, 1=note, 3=follows). Supports comma-separated values: -k 1,3,7",
      },
      {
        flag: "-a, --author <npub|hex|nip05|$me|$contacts>",
        description:
          "Filter by author pubkey. Supports comma-separated values.",
      },
      {
        flag: "-e <note|nevent|naddr|hex>",
        description:
          "Filter by event ID or coordinate. Supports comma-separated values.",
      },
      {
        flag: "-p <npub|hex|nip05|$me|$contacts>",
        description:
          "Filter by mentioned pubkey (#p tag). Supports comma-separated values.",
      },
      {
        flag: "-P <npub|hex|nip05|$me|$contacts>",
        description:
          "Filter by zap sender (#P tag). Supports comma-separated values.",
      },
      {
        flag: "-t <hashtag>",
        description:
          "Filter by hashtag (#t tag). Supports comma-separated values: -t nostr,bitcoin",
      },
      {
        flag: "-d <identifier>",
        description:
          "Filter by d-tag identifier (replaceable events). Supports comma-separated values.",
      },
      {
        flag: "-T, --tag <letter> <value>",
        description:
          "Filter by any single-letter tag. Supports comma-separated values.",
      },
      {
        flag: "--since <time>",
        description:
          "Events after timestamp (unix timestamp, relative: 30s, 1m, 2h, 7d, 2w, 3mo, 1y, or 'now')",
      },
      {
        flag: "--until <time>",
        description:
          "Events before timestamp (unix timestamp, relative: 30s, 1m, 2h, 7d, 2w, 3mo, 1y, or 'now')",
      },
      {
        flag: "--search <text>",
        description: "Search event content for text (relay-dependent)",
      },
    ],
    examples: [
      "count relay.damus.io -k 1 -a fiatjaf.com               Count posts from author",
      "count nos.lol -k 3 -p npub1...                         Count followers on specific relay",
      "count nos.lol relay.damus.io -k 1 -a npub1...          Compare counts across relays",
      "count relay.damus.io -k 9735 -p $me --since 30d        Count zaps received in last month",
      "count nos.lol -t nostr,bitcoin                         Count events with hashtags",
    ],
    seeAlso: ["req", "nip"],
    appId: "count",
    category: "Nostr",
    argParser: async (args: string[]) => {
      const parsed = parseCountCommand(args);

      // Resolve NIP-05 identifiers if present
      const allNip05 = [
        ...(parsed.nip05Authors || []),
        ...(parsed.nip05PTags || []),
        ...(parsed.nip05PTagsUppercase || []),
      ];

      if (allNip05.length > 0) {
        const resolved = await resolveNip05Batch(allNip05);

        if (parsed.nip05Authors) {
          for (const nip05 of parsed.nip05Authors) {
            const pubkey = resolved.get(nip05);
            if (pubkey) {
              if (!parsed.filter.authors) parsed.filter.authors = [];
              parsed.filter.authors.push(pubkey);
            }
          }
        }

        if (parsed.nip05PTags) {
          for (const nip05 of parsed.nip05PTags) {
            const pubkey = resolved.get(nip05);
            if (pubkey) {
              if (!parsed.filter["#p"]) parsed.filter["#p"] = [];
              parsed.filter["#p"].push(pubkey);
            }
          }
        }

        if (parsed.nip05PTagsUppercase) {
          for (const nip05 of parsed.nip05PTagsUppercase) {
            const pubkey = resolved.get(nip05);
            if (pubkey) {
              if (!parsed.filter["#P"]) parsed.filter["#P"] = [];
              parsed.filter["#P"].push(pubkey);
            }
          }
        }
      }

      // Resolve domain directories if present
      const allDomains = [
        ...(parsed.domainAuthors || []),
        ...(parsed.domainPTags || []),
        ...(parsed.domainPTagsUppercase || []),
      ];

      if (allDomains.length > 0) {
        const resolved = await resolveDomainDirectoryBatch(allDomains);

        if (parsed.domainAuthors) {
          for (const domain of parsed.domainAuthors) {
            const pubkeys = resolved.get(domain);
            if (pubkeys) {
              if (!parsed.filter.authors) parsed.filter.authors = [];
              parsed.filter.authors.push(...pubkeys);
            }
          }
        }

        if (parsed.domainPTags) {
          for (const domain of parsed.domainPTags) {
            const pubkeys = resolved.get(domain);
            if (pubkeys) {
              if (!parsed.filter["#p"]) parsed.filter["#p"] = [];
              parsed.filter["#p"].push(...pubkeys);
            }
          }
        }

        if (parsed.domainPTagsUppercase) {
          for (const domain of parsed.domainPTagsUppercase) {
            const pubkeys = resolved.get(domain);
            if (pubkeys) {
              if (!parsed.filter["#P"]) parsed.filter["#P"] = [];
              parsed.filter["#P"].push(...pubkeys);
            }
          }
        }
      }

      return parsed;
    },
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
      "open nevent1qgs8lft0t45k92c78n2zfe6ccvqzhpn977cd3h8wnl579zxhw5dvr9qqyz4nf2hlglhzhezygl5x2fdsg332fyd9q0p8ja7kvn0g53e0edzyxa32zg8  Open event with relay hints",
      "open naddr1qvzqqqrkvupzpn6956apxcad0mfp8grcuugdysg44eepex68h50t73zcathmfs49qy88wumn8ghj7mn0wvhxcmmv9uq3wamnwvaz7tmjv4kxz7fwdehhxarj9e3xzmny9uq3wamnwvaz7tmjv4kxz7fwwpexjmtpdshxuet59uq3qamnwvaz7tmwdaehgu3wd4hk6tcpz9mhxue69uhkummnw3ezuamfdejj7qghwaehxw309a3xjarrda5kuetj9eek7cmfv9kz7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uq3samnwvaz7tmxd9k8getj9ehx7um5wgh8w6twv5hszymhwden5te0danxvcmgv95kutnsw43z7qgawaehxw309ahx7um5wghxy6t5vdhkjmn9wgh8xmmrd9skctcpr9mhxue69uhhyetvv9ujuumwdae8gtnnda3kjctv9uqsuamnwvaz7tmev9382tndv5hsz9nhwden5te0wfjkccte9e3k76twdaeju6t09uq3vamnwvaz7tmjv4kxz7fwxvuns6np9eu8j730qqjr2vehvyenvdtr94nrzetr956rgctr94skvvfs95eryep3x3snwve389nxy97cjwx  Open addressable event",
      "open 30023:7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194:grimoire  Open by address pointer (kind:pubkey:d-tag)",
    ],
    seeAlso: ["req", "kind"],
    appId: "open",
    category: "Nostr",
    argParser: (args: string[]) => {
      const parsed = parseOpenCommand(args);
      return parsed;
    },
  },
  chat: {
    name: "chat",
    section: "1",
    synopsis: "chat <identifier>",
    description:
      "Join and participate in Nostr chat conversations. Supports NIP-29 relay-based groups, NIP-53 live activity chat, and multi-room group list interface. For NIP-29 groups, use format 'relay'group-id' where relay is the WebSocket URL (wss:// prefix optional). For NIP-53 live activities, pass the naddr of a kind 30311 live event. For multi-room interface, pass the naddr of a kind 10009 group list event.",
    options: [
      {
        flag: "<identifier>",
        description:
          "NIP-29 group (relay'group-id), NIP-53 live activity (naddr1... kind 30311), or group list (naddr1... kind 10009)",
      },
    ],
    examples: [
      "chat relay.example.com'bitcoin-dev        Join NIP-29 relay group",
      "chat wss://nos.lol'welcome                Join NIP-29 group with explicit protocol",
      "chat naddr1...30311...                    Join NIP-53 live activity chat",
      "chat naddr1...10009...                    Open multi-room group list interface",
    ],
    seeAlso: ["profile", "open", "req", "live"],
    appId: "chat",
    category: "Nostr",
    argParser: async (args: string[]) => {
      const result = parseChatCommand(args);
      return {
        protocol: result.protocol,
        identifier: result.identifier,
      };
    },
  },
  profile: {
    name: "profile",
    section: "1",
    synopsis: "profile <identifier>",
    description:
      "Open a detailed view of a Nostr user profile. Accepts multiple identifier formats including npub, nprofile, hex pubkeys, NIP-05 identifiers (including bare domains), and the $me alias. Displays profile metadata, inbox/outbox relays, and raw JSON.",
    options: [
      {
        flag: "<identifier>",
        description: "User identifier in any supported format (see examples)",
      },
    ],
    examples: [
      "profile fiatjaf.com                   Open profile by NIP-05 identifier",
      "profile $me                          Open your own profile",
      "profile nprofile1qyd8wumn8ghj7urewfsk66ty9enxjct5dfskvtnrdakj7qgmwaehxw309a6xsetxdaex2um59ehx7um5wgcjucm0d5hsz9mhwden5te0veex2mnn9ehx7um5wgcjucm0d5hszxrhwden5te0ve5kcar9wghxummnw3ezuamfdejj7qpq07jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2q0al9p4  Open profile with relay hints",
      "profile 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d  Open profile by hex pubkey (64 chars)",
      "profile dergigi.com                   Open profile by domain (resolves to _@dergigi.com)",
      "profile jack@cash.app                 Open profile using NIP-05",
    ],
    seeAlso: ["open", "req"],
    appId: "profile",
    category: "Nostr",
    argParser: async (args: string[], activeAccountPubkey?: string) => {
      const parsed = await parseProfileCommand(args, activeAccountPubkey);
      return parsed;
    },
  },
  zap: {
    name: "zap",
    section: "1",
    synopsis:
      "zap <profile|event> [event] [-T <type> <value> [relay]] [-r <relay>]",
    description:
      "Send a Lightning zap (NIP-57) to a Nostr user or event. Zaps are Lightning payments with proof published to Nostr. Supports zapping profiles directly or events with context. Custom tags can be added for protocol-specific tagging (e.g., NIP-53 live activities). Requires the recipient to have a Lightning address (lud16/lud06) configured in their profile.",
    options: [
      {
        flag: "<profile>",
        description:
          "Recipient: npub, nprofile, hex pubkey, user@domain.com, $me",
      },
      {
        flag: "<event>",
        description: "Event to zap: note, nevent, naddr, hex ID (optional)",
      },
      {
        flag: "-T, --tag <type> <value> [relay]",
        description:
          "Add custom tag to zap request (can be repeated). Used for protocol-specific tagging like NIP-53 a-tags",
      },
      {
        flag: "-r, --relay <url>",
        description:
          "Relay where zap receipt should be published (can be repeated)",
      },
    ],
    examples: [
      "zap fiatjaf.com                      Zap a user by NIP-05",
      "zap npub1...                         Zap a user by npub",
      "zap nevent1...                       Zap an event (recipient = event author)",
      "zap npub1... nevent1...              Zap a specific user for a specific event",
      "zap alice@domain.com naddr1...       Zap with event context",
      "zap npub1... -T a 30311:pk:id wss://relay.example.com    Zap with live activity a-tag",
      "zap npub1... -r wss://relay1.com -r wss://relay2.com     Zap with custom relays",
    ],
    seeAlso: ["profile", "open", "wallet"],
    appId: "zap",
    category: "Nostr",
    argParser: async (args: string[], activeAccountPubkey?: string) => {
      const parsed = await parseZapCommand(args, activeAccountPubkey);
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
      "encode npub 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d  Encode pubkey to npub",
      "encode nprofile 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d --relay wss://theforest.nostr1.com  Encode profile with relay",
      "encode note 5c83da77af1dec6d7289834998ad7aafbd9e2191396d75ec3cc27f5a77226f36  Encode event ID to note",
      "encode nevent 5c83da77af1dec6d7289834998ad7aafbd9e2191396d75ec3cc27f5a77226f36 --relay wss://theforest.nostr1.com --author 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d  Encode event with metadata",
      "encode naddr 30023:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:my-article --relay wss://theforest.nostr1.com  Encode addressable event",
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
      "decode nprofile1qyd8wumn8ghj7urewfsk66ty9enxjct5dfskvtnrdakj7qgmwaehxw309a6xsetxdaex2um59ehx7um5wgcjucm0d5hsz9mhwden5te0veex2mnn9ehx7um5wgcjucm0d5hszxrhwden5te0ve5kcar9wghxummnw3ezuamfdejj7qpq07jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2q0al9p4  Decode nprofile with relay hints",
      "decode nevent1qgs8lft0t45k92c78n2zfe6ccvqzhpn977cd3h8wnl579zxhw5dvr9qqyz4nf2hlglhzhezygl5x2fdsg332fyd9q0p8ja7kvn0g53e0edzyxa32zg8  Decode nevent showing ID, relays, author",
      "decode naddr1qvzqqqrkvupzpn6956apxcad0mfp8grcuugdysg44eepex68h50t73zcathmfs49qy88wumn8ghj7mn0wvhxcmmv9uq3wamnwvaz7tmjv4kxz7fwdehhxarj9e3xzmny9uq3wamnwvaz7tmjv4kxz7fwwpexjmtpdshxuet59uq3qamnwvaz7tmwdaehgu3wd4hk6tcpz9mhxue69uhkummnw3ezuamfdejj7qghwaehxw309a3xjarrda5kuetj9eek7cmfv9kz7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uq3samnwvaz7tmxd9k8getj9ehx7um5wgh8w6twv5hszymhwden5te0danxvcmgv95kutnsw43z7qgawaehxw309ahx7um5wghxy6t5vdhkjmn9wgh8xmmrd9skctcpr9mhxue69uhhyetvv9ujuumwdae8gtnnda3kjctv9uqsuamnwvaz7tmev9382tndv5hsz9nhwden5te0wfjkccte9e3k76twdaeju6t09uq3vamnwvaz7tmjv4kxz7fwxvuns6np9eu8j730qqjr2vehvyenvdtr94nrzetr956rgctr94skvvfs95eryep3x3snwve389nxy97cjwx  Decode naddr showing kind, pubkey, identifier",
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
  conn: {
    name: "conn",
    section: "1",
    synopsis: "conn",
    description:
      "Monitor all relay connections in the pool. Displays real-time connection status, authentication state, pending auth challenges, relay notices, and connection statistics. Manage auth preferences per relay (always/never/ask).",
    examples: ["conn    View all relay connections and auth status"],
    seeAlso: ["relay", "req"],
    appId: "conn",
    category: "System",
    defaultProps: {},
  },
  spells: {
    name: "spells",
    section: "1",
    synopsis: "spells",
    description:
      "Browse and manage your REQ command spells. Spells are saved queries that can be run instantly. You can save spells locally or publish them as Nostr events (kind 777) to relays, making them portable and shareable. Use the 'Save as Spell' button in any REQ window to create new spells.",
    examples: ["spells          Browse your saved spells"],
    seeAlso: ["req"],
    appId: "spells",
    category: "Nostr",
    defaultProps: {},
  },
  blossom: {
    name: "blossom",
    section: "1",
    synopsis: "blossom <subcommand> [options]",
    description:
      "Manage blob storage on Blossom servers. Upload, list, and manage media files using the Blossom protocol (BUD specs). Your Blossom server list is stored in a kind 10063 event.",
    options: [
      {
        flag: "servers",
        description:
          "Show your configured Blossom servers from kind 10063 event",
      },
      {
        flag: "server <url>",
        description: "View info about a specific Blossom server",
      },
      {
        flag: "upload",
        description:
          "Open file upload dialog to upload files to your Blossom servers",
      },
      {
        flag: "list [pubkey]",
        description:
          "List blobs uploaded by a user. Supports npub, hex, NIP-05 (user@domain.com), or $me",
      },
      {
        flag: "blob <sha256> [server]",
        description:
          "View details and preview of a specific blob by its SHA256 hash",
      },
      {
        flag: "mirror <url> <server>",
        description: "Mirror a blob from a URL to another Blossom server",
      },
      {
        flag: "delete <sha256> <server>",
        description: "Delete a blob from a Blossom server",
      },
    ],
    examples: [
      "blossom                              Show your Blossom servers",
      "blossom servers                      Show your Blossom servers",
      "blossom server blossom.primal.net    View specific server info",
      "blossom upload                       Open file upload dialog",
      "blossom list                         List your uploaded blobs",
      "blossom list fiatjaf.com             List blobs for a NIP-05 user",
      "blossom list npub1...                List blobs for another user",
      "blossom blob abc123...               View blob details",
      "blossom mirror https://... cdn.example.com  Mirror blob to server",
    ],
    seeAlso: ["profile"],
    appId: "blossom",
    category: "Nostr",
    argParser: async (args: string[], activeAccountPubkey?: string) => {
      return await parseBlossomCommand(args, activeAccountPubkey);
    },
    defaultProps: { subcommand: "servers" },
  },
  wallet: {
    name: "wallet",
    section: "1",
    synopsis: "wallet",
    description:
      "View and manage your Nostr Wallet Connect (NWC) Lightning wallet. Display wallet balance, transaction history, send/receive payments, and view wallet capabilities. The wallet interface adapts based on the methods supported by your connected wallet provider.",
    examples: ["wallet    Open wallet viewer and manage Lightning payments"],
    seeAlso: ["profile"],
    appId: "wallet",
    category: "Nostr",
    defaultProps: {},
  },
  post: {
    name: "post",
    section: "1",
    synopsis: "post",
    description:
      "Compose and publish a Nostr note (kind 1). Features a rich text editor with @mentions, :emoji: autocomplete, and image/video attachments. Select which relays to publish to, with write relays pre-selected by default. Track per-relay publish status (loading/success/error).",
    examples: ["post    Open post composer"],
    seeAlso: ["req", "profile", "blossom"],
    appId: "post",
    category: "Nostr",
    defaultProps: {},
  },
  settings: {
    name: "settings",
    section: "1",
    synopsis: "settings",
    description:
      "Configure Grimoire application settings. Includes post composition settings (client tag), appearance settings (theme, show client tags), and more. Settings are persisted to localStorage and synchronized across all windows.",
    examples: ["settings    Open settings panel"],
    seeAlso: ["post", "help"],
    appId: "settings",
    category: "System",
    defaultProps: {},
  },
};
