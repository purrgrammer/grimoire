/**
 * NIP Icon Mapping
 * Maps NIP numbers to Lucide icons for visual representation
 */

import {
  FileText,
  Lock,
  Hash,
  MessageSquare,
  Tag,
  Image,
  Link,
  Zap,
  Key,
  Shield,
  Search,
  Calendar,
  Users,
  Mail,
  Gift,
  Flag,
  AlertCircle,
  Globe,
  Server,
  Database,
  Eye,
  Heart,
  Star,
  Bookmark,
  Share2,
  Filter,
  Coins,
  Video,
  Music,
  Code,
  ShoppingCart,
  GitBranch,
  Package,
  Wallet,
  Radio,
  Compass,
  Gamepad2,
  type LucideIcon,
} from "lucide-react";

export interface NIPInfo {
  number: number;
  name: string;
  description: string;
  icon: LucideIcon;
  deprecated?: boolean;
}

export const NIP_METADATA: Record<number | string, NIPInfo> = {
  // Core Protocol
  1: {
    number: 1,
    name: "Basic Protocol",
    description: "Basic protocol flow description",
    icon: FileText,
  },
  2: {
    number: 2,
    name: "Follow List",
    description: "Contact list and petnames",
    icon: Users,
  },
  4: {
    number: 4,
    name: "Encrypted DMs",
    description: "Encrypted direct messages",
    icon: Mail,
    deprecated: true,
  },
  5: {
    number: 5,
    name: "Mapping Nostr keys to DNS",
    description: "Mapping Nostr keys to DNS-based internet identifiers",
    icon: Globe,
  },
  6: {
    number: 6,
    name: "Key Derivation",
    description: "Basic key derivation from mnemonic seed phrase",
    icon: Key,
  },
  7: {
    number: 7,
    name: "window.nostr",
    description: "window.nostr capability for web browsers",
    icon: Globe,
  },
  8: {
    number: 8,
    name: "Mentions",
    description: "Handling mentions",
    icon: Tag,
    deprecated: true,
  },
  9: {
    number: 9,
    name: "Event Deletion",
    description: "Event deletion",
    icon: AlertCircle,
  },
  10: {
    number: 10,
    name: "Conventions",
    description: "Conventions for clients' use of e and p tags",
    icon: Tag,
  },
  11: {
    number: 11,
    name: "Relay Info",
    description: "Relay information document",
    icon: Server,
  },
  13: {
    number: 13,
    name: "Proof of Work",
    description: "Proof of work",
    icon: Zap,
  },
  14: {
    number: 14,
    name: "Subject Tag",
    description: "Subject tag in text events",
    icon: Tag,
  },
  15: {
    number: 15,
    name: "Marketplace",
    description: "Marketplace (for resilient marketplaces)",
    icon: ShoppingCart,
  },
  17: {
    number: 17,
    name: "Private DMs",
    description: "Private Direct Messages",
    icon: Lock,
  },
  18: { number: 18, name: "Reposts", description: "Reposts", icon: Share2 },
  19: {
    number: 19,
    name: "bech32 Entities",
    description: "bech32-encoded entities",
    icon: Hash,
  },
  21: {
    number: 21,
    name: "nostr: URI",
    description: "nostr: URI scheme",
    icon: Link,
  },
  22: {
    number: 22,
    name: "Comment",
    description: "Comment",
    icon: MessageSquare,
  },
  23: {
    number: 23,
    name: "Long-form",
    description: "Long-form content",
    icon: FileText,
  },
  24: {
    number: 24,
    name: "Extra Metadata",
    description: "Extra metadata fields and tags",
    icon: Tag,
  },
  25: { number: 25, name: "Reactions", description: "Reactions", icon: Heart },
  26: {
    number: 26,
    name: "Delegated Signing",
    description: "Delegated event signing",
    icon: Key,
    deprecated: true,
  },
  27: {
    number: 27,
    name: "Text Note References",
    description: "Text note references",
    icon: Link,
  },
  28: {
    number: 28,
    name: "Public Chat",
    description: "Public chat",
    icon: MessageSquare,
  },
  29: {
    number: 29,
    name: "Relay Groups",
    description: "Relay-based groups",
    icon: Users,
  },
  30: {
    number: 30,
    name: "Custom Emoji",
    description: "Custom emoji",
    icon: Gift,
  },
  31: {
    number: 31,
    name: "Unknown Events",
    description: "Dealing with unknown event kinds",
    icon: AlertCircle,
  },
  32: { number: 32, name: "Labeling", description: "Labeling", icon: Tag },
  34: { number: 34, name: "Git", description: "git stuff", icon: GitBranch },
  35: { number: 35, name: "Torrents", description: "Torrents", icon: Share2 },
  36: {
    number: 36,
    name: "Sensitive Content",
    description: "Sensitive content warnings",
    icon: Eye,
  },
  37: {
    number: 37,
    name: "Draft Events",
    description: "Draft Events",
    icon: FileText,
  },
  38: {
    number: 38,
    name: "User Status",
    description: "User statuses",
    icon: Flag,
  },
  39: {
    number: 39,
    name: "External Identity",
    description: "External identities in profiles",
    icon: Globe,
  },
  40: {
    number: 40,
    name: "Expiration",
    description: "Expiration timestamp",
    icon: Calendar,
  },
  42: {
    number: 42,
    name: "Authentication",
    description: "Authentication of clients to relays",
    icon: Shield,
  },
  43: {
    number: 43,
    name: "Relay Access",
    description: "Fast Authentication and Relay Access",
    icon: Server,
  },
  44: {
    number: 44,
    name: "Encrypted Payloads",
    description: "Encrypted Payloads (Versioned)",
    icon: Lock,
  },
  45: {
    number: 45,
    name: "Event Counts",
    description: "Counting results",
    icon: Hash,
  },
  46: {
    number: 46,
    name: "Remote Signing",
    description: "Nostr connect protocol",
    icon: Key,
  },
  47: {
    number: 47,
    name: "Wallet Connect",
    description: "Wallet connect",
    icon: Wallet,
  },
  48: { number: 48, name: "Proxy Tags", description: "Proxy tags", icon: Tag },
  49: {
    number: 49,
    name: "Private Key Encryption",
    description: "Private key encryption",
    icon: Lock,
  },
  50: {
    number: 50,
    name: "Search",
    description: "Search capability",
    icon: Search,
  },
  51: { number: 51, name: "Lists", description: "Lists", icon: Filter },
  52: {
    number: 52,
    name: "Calendar Events",
    description: "Calendar Events",
    icon: Calendar,
  },
  53: {
    number: 53,
    name: "Live Activities",
    description: "Live Activities",
    icon: Radio,
  },
  54: { number: 54, name: "Wiki", description: "Wiki", icon: FileText },
  55: {
    number: 55,
    name: "Android Signer",
    description: "Android Signer Application",
    icon: Key,
  },
  56: { number: 56, name: "Reporting", description: "Reporting", icon: Flag },
  57: {
    number: 57,
    name: "Lightning Zaps",
    description: "Lightning zaps",
    icon: Zap,
  },
  58: { number: 58, name: "Badges", description: "Badges", icon: Star },
  59: { number: 59, name: "Gift Wrap", description: "Gift Wrap", icon: Gift },
  60: {
    number: 60,
    name: "Cashu Wallet",
    description: "Cashu Wallet",
    icon: Wallet,
  },
  61: { number: 61, name: "Nutzaps", description: "Nutzaps", icon: Zap },
  62: {
    number: 62,
    name: "Request to Vanish",
    description: "Request to Vanish",
    icon: Eye,
  },
  64: { number: 64, name: "Chess", description: "Chess (PGN)", icon: Gamepad2 },
  65: {
    number: 65,
    name: "Relay List",
    description: "Relay list metadata",
    icon: Server,
  },
  66: {
    number: 66,
    name: "Relay Discovery",
    description: "Relay Discovery",
    icon: Compass,
  },
  68: {
    number: 68,
    name: "Picture-first",
    description: "Picture-first feeds",
    icon: Image,
  },
  69: {
    number: 69,
    name: "P2P Order",
    description: "Peer-to-peer Order events",
    icon: ShoppingCart,
  },
  70: {
    number: 70,
    name: "Protected Events",
    description: "Protected Events",
    icon: Shield,
  },
  71: {
    number: 71,
    name: "Video Events",
    description: "Video Events",
    icon: Video,
  },
  72: {
    number: 72,
    name: "Moderation",
    description: "Moderated communities",
    icon: Shield,
  },
  73: {
    number: 73,
    name: "External Content IDs",
    description: "External Content IDs",
    icon: Link,
  },
  75: { number: 75, name: "Zap Goals", description: "Zap Goals", icon: Zap },
  77: {
    number: 77,
    name: "Negentropy",
    description: "Negentropy Protocol Sync",
    icon: Server,
  },
  78: {
    number: 78,
    name: "App Data",
    description: "Application-specific data",
    icon: Database,
  },
  84: {
    number: 84,
    name: "Highlights",
    description: "Highlights",
    icon: Bookmark,
  },
  86: {
    number: 86,
    name: "Relay Management",
    description: "Relay Management API",
    icon: Server,
  },
  87: {
    number: 87,
    name: "Ecash Mints",
    description: "Ecash Mint Discoverability",
    icon: Coins,
  },
  88: { number: 88, name: "Polls", description: "Polls", icon: Filter },
  89: {
    number: 89,
    name: "App Handlers",
    description: "Recommended application handlers",
    icon: Package,
  },
  90: {
    number: 90,
    name: "Data Vending",
    description: "Data Vending Machines",
    icon: Database,
  },
  92: {
    number: 92,
    name: "Media Attachments",
    description: "Media Attachments",
    icon: Image,
  },
  94: {
    number: 94,
    name: "File Metadata",
    description: "File metadata",
    icon: Image,
  },
  96: {
    number: 96,
    name: "HTTP File Storage",
    description: "HTTP File Storage Integration",
    icon: Server,
    deprecated: true,
  },
  98: {
    number: 98,
    name: "HTTP Auth",
    description: "HTTP authentication",
    icon: Lock,
  },
  99: {
    number: 99,
    name: "Classified Listings",
    description: "Classified listings",
    icon: Tag,
  },

  // Hex NIPs (A0-EE)
  A0: {
    number: 0xa0,
    name: "Voice Messages",
    description: "Voice Messages",
    icon: Music,
  },
  B0: {
    number: 0xb0,
    name: "Web Bookmarks",
    description: "Web Bookmarks",
    icon: Bookmark,
  },
  B7: { number: 0xb7, name: "Blossom", description: "Blossom", icon: Package },
  BE: {
    number: 0xbe,
    name: "BLE",
    description: "BLE Communications",
    icon: Radio,
  },
  C0: {
    number: 0xc0,
    name: "Code Snippets",
    description: "Code Snippets",
    icon: Code,
  },
  C7: {
    number: 0xc7,
    name: "Chats",
    description: "Chats",
    icon: MessageSquare,
  },
  EE: {
    number: 0xee,
    name: "E2EE MLS",
    description: "E2EE Messaging (MLS)",
    icon: Lock,
  },
  "7D": {
    number: 0x7d,
    name: "Threads",
    description: "Threads",
    icon: MessageSquare,
  },
};

/**
 * Get NIP metadata by number (handles both decimal and hex)
 */
export function getNIPInfo(nipNumber: number | string): NIPInfo | undefined {
  // Try direct lookup
  if (NIP_METADATA[nipNumber]) {
    return NIP_METADATA[nipNumber];
  }

  // Try hex conversion for numbers > 99
  if (typeof nipNumber === "number" && nipNumber > 99) {
    const hexKey = nipNumber.toString(16).toUpperCase();
    return NIP_METADATA[hexKey];
  }

  return undefined;
}

/**
 * Get all supported NIPs with their metadata, excluding deprecated ones
 */
export function getSupportedNIPsInfo(
  nipNumbers: number[],
  includeDeprecated: boolean = false,
): (NIPInfo | { number: number; name: string; icon: LucideIcon })[] {
  return nipNumbers
    .map((num) => {
      const info = getNIPInfo(num);
      if (info) {
        // Skip deprecated NIPs unless explicitly included
        if (!includeDeprecated && info.deprecated) {
          return null;
        }
        return info;
      }
      // Fallback for unknown NIPs
      return {
        number: num,
        name: `NIP-${num}`,
        icon: FileText,
      };
    })
    .filter(
      (
        nip,
      ): nip is NIPInfo | { number: number; name: string; icon: LucideIcon } =>
        nip !== null,
    );
}

/**
 * Group NIPs by a single consolidated category
 * For relay viewer, we show all NIPs in one list
 */
export function groupNIPsByCategory(
  nipNumbers: number[],
): Record<string, NIPInfo[]> {
  const grouped: Record<string, NIPInfo[]> = {
    "Supported NIPs": [],
  };

  nipNumbers.forEach((num) => {
    const info = getNIPInfo(num);
    // Skip deprecated NIPs
    if (info && !info.deprecated) {
      grouped["Supported NIPs"].push(info);
    }
  });

  return grouped;
}
