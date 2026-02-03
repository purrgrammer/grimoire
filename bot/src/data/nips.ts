/**
 * NIP (Nostr Implementation Possibilities) definitions
 * Used by the bot to provide information about NIPs
 */

export interface NipInfo {
  id: string;
  title: string;
  description: string;
  deprecated?: boolean;
}

export const NIP_DATA: Record<string, NipInfo> = {
  "01": {
    id: "01",
    title: "Basic protocol flow description",
    description:
      "Defines the basic protocol: event structure, signatures, relay communication, and basic event kinds (0=metadata, 1=text note, 2=relay recommendation).",
  },
  "02": {
    id: "02",
    title: "Follow List",
    description:
      "Kind 3 contact list - stores the list of pubkeys a user follows along with relay preferences.",
  },
  "03": {
    id: "03",
    title: "OpenTimestamps Attestations for Events",
    description: "Timestamping events using OpenTimestamps.",
  },
  "04": {
    id: "04",
    title: "Encrypted Direct Message",
    description:
      "Legacy encrypted DMs (kind 4). DEPRECATED - use NIP-17 instead for better privacy.",
    deprecated: true,
  },
  "05": {
    id: "05",
    title: "Mapping Nostr keys to DNS-based internet identifiers",
    description:
      "NIP-05 verification - maps user@domain.com to a pubkey via .well-known/nostr.json.",
  },
  "06": {
    id: "06",
    title: "Basic key derivation from mnemonic seed phrase",
    description: "Derive Nostr keys from BIP-39 mnemonic seed phrases.",
  },
  "07": {
    id: "07",
    title: "window.nostr capability for web browsers",
    description:
      "Browser extension interface for signing - allows web apps to request event signing from extensions like nos2x, Alby.",
  },
  "09": {
    id: "09",
    title: "Event Deletion Request",
    description:
      "Kind 5 deletion requests - request relays to delete specified events.",
  },
  "10": {
    id: "10",
    title: "Text Notes and Threads",
    description:
      "Conventions for text notes (kind 1), threading with e-tags (root, reply, mention markers).",
  },
  "11": {
    id: "11",
    title: "Relay Information Document",
    description:
      "NIP-11 relay info - GET /.well-known/nostr.json returns relay metadata (name, description, supported NIPs, fees).",
  },
  "13": {
    id: "13",
    title: "Proof of Work",
    description:
      "Add proof of work to events by finding a nonce that produces a hash with leading zeros.",
  },
  "15": {
    id: "15",
    title: "Nostr Marketplace",
    description:
      "Stalls (kind 30017), products (kind 30018), and orders for marketplace functionality.",
  },
  "17": {
    id: "17",
    title: "Private Direct Messages",
    description:
      "Modern encrypted DMs (kind 14) using gift wrapping for better metadata privacy. Replaces NIP-04.",
  },
  "18": {
    id: "18",
    title: "Reposts",
    description:
      "Kind 6 for reposting kind 1 notes, kind 16 for generic reposts of any event type.",
  },
  "19": {
    id: "19",
    title: "bech32-encoded entities",
    description:
      "Bech32 encoding: npub (pubkey), nsec (private key), note (event id), nprofile, nevent, naddr, nrelay.",
  },
  "21": {
    id: "21",
    title: "nostr: URI scheme",
    description: "nostr: URI scheme for linking to Nostr entities.",
  },
  "22": {
    id: "22",
    title: "Comment",
    description:
      "Kind 1111 comments - comment on any addressable content (articles, videos, etc.).",
  },
  "23": {
    id: "23",
    title: "Long-form Content",
    description:
      "Kind 30023 articles - long-form markdown content with title, summary, published_at tags.",
  },
  "25": {
    id: "25",
    title: "Reactions",
    description:
      "Kind 7 reactions - react to events with '+', '-', or emoji. Uses e-tag to reference target.",
  },
  "27": {
    id: "27",
    title: "Text Note References",
    description:
      "Reference and quote other events within notes using nostr: URIs.",
  },
  "28": {
    id: "28",
    title: "Public Chat",
    description:
      "Public chat channels - kind 40 (create), kind 41 (metadata), kind 42 (messages).",
  },
  "29": {
    id: "29",
    title: "Relay-based Groups",
    description:
      "NIP-29 groups - relay-enforced groups with kind 9 messages, group metadata (39000), admins (39001), members (39002). Messages use h-tag for group context.",
  },
  "30": {
    id: "30",
    title: "Custom Emoji",
    description:
      "Custom emoji using emoji tags - :shortcode: syntax with image URLs.",
  },
  "32": {
    id: "32",
    title: "Labeling",
    description: "Kind 1985 labels - categorize and tag content.",
  },
  "34": {
    id: "34",
    title: "git stuff",
    description:
      "Git collaboration - repositories (30617), patches (1617), issues (1621), and more.",
  },
  "36": {
    id: "36",
    title: "Sensitive Content",
    description: "Content warnings using content-warning tag.",
  },
  "38": {
    id: "38",
    title: "User Statuses",
    description:
      "Kind 30315 user statuses - what user is doing, listening to, etc.",
  },
  "42": {
    id: "42",
    title: "Authentication of clients to relays",
    description:
      "AUTH message for relay authentication - kind 22242 for client auth challenges.",
  },
  "44": {
    id: "44",
    title: "Encrypted Payloads (Versioned)",
    description: "Versioned encryption for payloads.",
  },
  "45": {
    id: "45",
    title: "Counting results",
    description:
      "COUNT message to get event counts without fetching all events.",
  },
  "46": {
    id: "46",
    title: "Nostr Remote Signing",
    description:
      "Remote signing via kind 24133 - allows signing events on a different device.",
  },
  "47": {
    id: "47",
    title: "Nostr Wallet Connect",
    description:
      "NWC - connect wallets to apps for lightning payments via kind 13194, 23194, 23195.",
  },
  "50": {
    id: "50",
    title: "Search Capability",
    description: "Search filter support in REQ - use search field in filters.",
  },
  "51": {
    id: "51",
    title: "Lists",
    description:
      "Various list types - mute (10000), pin (10001), bookmark (10003), follow sets (30000), etc.",
  },
  "52": {
    id: "52",
    title: "Calendar Events",
    description:
      "Calendar events - date-based (31922), time-based (31923), calendars (31924), RSVPs (31925).",
  },
  "53": {
    id: "53",
    title: "Live Activities",
    description:
      "Live streaming - kind 30311 live events, kind 1311 chat messages.",
  },
  "56": {
    id: "56",
    title: "Reporting",
    description: "Kind 1984 reports for content moderation.",
  },
  "57": {
    id: "57",
    title: "Lightning Zaps",
    description:
      "Zaps - kind 9734 zap requests, kind 9735 zap receipts. Integrates lightning payments.",
  },
  "58": {
    id: "58",
    title: "Badges",
    description:
      "Badge system - kind 30009 (define), kind 8 (award), kind 30008 (profile badges).",
  },
  "59": {
    id: "59",
    title: "Gift Wrap",
    description:
      "Gift wrap encryption (kind 1059) - wraps events for privacy. Used by NIP-17.",
  },
  "65": {
    id: "65",
    title: "Relay List Metadata",
    description:
      "Kind 10002 relay list - defines user's read/write relay preferences for inbox/outbox model.",
  },
  "72": {
    id: "72",
    title: "Moderated Communities",
    description:
      "Communities with moderation - kind 34550 community definition, kind 4550 approved posts.",
  },
  "78": {
    id: "78",
    title: "Application-specific data",
    description: "Kind 30078 for app-specific user data storage.",
  },
  "84": {
    id: "84",
    title: "Highlights",
    description:
      "Kind 9802 highlights - save and share text highlights from content.",
  },
  "89": {
    id: "89",
    title: "Recommended Application Handlers",
    description:
      "Kind 31990 app definitions, kind 31989 recommendations for handling event kinds.",
  },
  "90": {
    id: "90",
    title: "Data Vending Machines",
    description:
      "DVMs - kind 5000-5999 job requests, kind 6000-6999 results, kind 7000 feedback.",
  },
  "94": {
    id: "94",
    title: "File Metadata",
    description: "Kind 1063 file metadata for files stored on servers.",
  },
  "98": {
    id: "98",
    title: "HTTP Auth",
    description: "Kind 27235 HTTP authentication using Nostr.",
  },
};

/**
 * Get NIP info by ID
 */
export function getNipInfo(nipId: string): NipInfo | undefined {
  // Normalize to uppercase and pad if needed
  const normalized = nipId.toUpperCase().padStart(2, "0");
  return NIP_DATA[normalized];
}

/**
 * Search NIPs by title or description
 */
export function searchNips(query: string): NipInfo[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(NIP_DATA).filter(
    (n) =>
      n.title.toLowerCase().includes(lowerQuery) ||
      n.description.toLowerCase().includes(lowerQuery),
  );
}
