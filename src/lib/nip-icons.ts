/**
 * NIP Icon Mapping
 * Maps NIP identifiers to Lucide icons for visual representation
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
  Boxes,
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
  CheckCheck,
  MapPin,
  Podcast,
  type LucideIcon,
  Signature,
} from "lucide-react";

export interface NIPInfo {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  deprecated?: boolean;
}

export const NIP_METADATA: Record<string, NIPInfo> = {
  // Core Protocol
  "01": {
    id: "01",
    name: "Basic Protocol",
    description: "Basic protocol flow description",
    icon: FileText,
  },
  "02": {
    id: "02",
    name: "Follow List",
    description: "Contact list and petnames",
    icon: Users,
  },
  "03": {
    id: "03",
    name: "OpenTimestamps Attestations for Events",
    description: "A proof of any event",
    icon: Signature,
    deprecated: true,
  },
  "04": {
    id: "04",
    name: "Encrypted DMs",
    description: "Encrypted direct messages",
    icon: Mail,
    deprecated: true,
  },
  "05": {
    id: "05",
    name: "Mapping Nostr keys to DNS",
    description: "Mapping Nostr keys to DNS-based internet identifiers",
    icon: Globe,
  },
  "06": {
    id: "06",
    name: "Key Derivation",
    description: "Basic key derivation from mnemonic seed phrase",
    icon: Key,
    deprecated: true,
  },
  "07": {
    id: "07",
    name: "window.nostr",
    description: "window.nostr capability for web browsers",
    icon: Globe,
  },
  "08": {
    id: "08",
    name: "Mentions",
    description: "Handling mentions",
    icon: Tag,
    deprecated: true,
  },
  "09": {
    id: "09",
    name: "Event Deletion",
    description: "Event deletion",
    icon: AlertCircle,
  },
  "10": {
    id: "10",
    name: "Conventions",
    description: "Conventions for clients' use of e and p tags",
    icon: Tag,
  },
  "11": {
    id: "11",
    name: "Relay Info",
    description: "Relay information document",
    icon: Server,
  },
  "13": {
    id: "13",
    name: "Proof of Work",
    description: "Proof of work",
    icon: Zap,
  },
  "14": {
    id: "14",
    name: "Subject Tag",
    description: "Subject tag in text events",
    icon: Tag,
  },
  "15": {
    id: "15",
    name: "Marketplace",
    description: "Marketplace (for resilient marketplaces)",
    icon: ShoppingCart,
    deprecated: true,
  },
  "17": {
    id: "17",
    name: "Private DMs",
    description: "Private Direct Messages",
    icon: Lock,
  },
  "18": { id: "18", name: "Reposts", description: "Reposts", icon: Share2 },
  "19": {
    id: "19",
    name: "bech32 Entities",
    description: "bech32-encoded entities",
    icon: Hash,
  },
  "21": {
    id: "21",
    name: "nostr: URI",
    description: "nostr: URI scheme",
    icon: Link,
  },
  "22": {
    id: "22",
    name: "Comment",
    description: "Comment",
    icon: MessageSquare,
  },
  "23": {
    id: "23",
    name: "Long-form",
    description: "Long-form content",
    icon: FileText,
  },
  "24": {
    id: "24",
    name: "Extra Metadata",
    description: "Extra metadata fields and tags",
    icon: Tag,
  },
  "25": { id: "25", name: "Reactions", description: "Reactions", icon: Heart },
  "26": {
    id: "26",
    name: "Delegated Signing",
    description: "Delegated event signing",
    icon: Key,
    deprecated: true,
  },
  "27": {
    id: "27",
    name: "Text Note References",
    description: "Text note references",
    icon: Link,
  },
  "28": {
    id: "28",
    name: "Public Chat",
    description: "Public chat",
    icon: MessageSquare,
    deprecated: true,
  },
  "29": {
    id: "29",
    name: "Relay Groups",
    description: "Relay-based groups",
    icon: Users,
  },
  "30": {
    id: "30",
    name: "Custom Emoji",
    description: "Custom emoji",
    icon: Gift,
  },
  "31": {
    id: "31",
    name: "Unknown Events",
    description: "Dealing with unknown event kinds",
    icon: AlertCircle,
    deprecated: true,
  },
  "32": { id: "32", name: "Labeling", description: "Labeling", icon: Tag },
  "34": { id: "34", name: "Git", description: "git stuff", icon: GitBranch },
  "35": { id: "35", name: "Torrents", description: "Torrents", icon: Share2 },
  "36": {
    id: "36",
    name: "Sensitive Content",
    description: "Sensitive content warnings",
    icon: Eye,
  },
  "37": {
    id: "37",
    name: "Draft Events",
    description: "Draft Events",
    icon: FileText,
  },
  "38": {
    id: "38",
    name: "User Status",
    description: "User statuses",
    icon: Flag,
  },
  "39": {
    id: "39",
    name: "Profile Links",
    description: "Linking profiles to other platforms",
    icon: Globe,
  },
  "40": {
    id: "40",
    name: "Expiration",
    description: "Expiration timestamp",
    icon: Calendar,
  },
  "42": {
    id: "42",
    name: "Authentication",
    description: "Authentication of clients to relays",
    icon: Shield,
  },
  "43": {
    id: "43",
    name: "Relay Access",
    description: "Fast Authentication and Relay Access",
    icon: Server,
  },
  "44": {
    id: "44",
    name: "Encrypted Payloads",
    description: "Encrypted Payloads (Versioned)",
    icon: Lock,
  },
  "45": {
    id: "45",
    name: "Event Counts",
    description: "Counting results",
    icon: Hash,
  },
  "46": {
    id: "46",
    name: "Remote Signing",
    description: "Nostr connect protocol",
    icon: Key,
  },
  "47": {
    id: "47",
    name: "Wallet Connect",
    description: "Wallet connect",
    icon: Wallet,
  },
  "48": {
    id: "48",
    name: "Bridged Events",
    description: "Bridged events",
    icon: Tag,
  },
  "49": {
    id: "49",
    name: "Private Key Encryption",
    description: "Private key encryption (ncryptsec)",
    icon: Lock,
  },
  "50": {
    id: "50",
    name: "Search",
    description: "Search capability",
    icon: Search,
  },
  "51": { id: "51", name: "Lists", description: "Lists", icon: Filter },
  "52": {
    id: "52",
    name: "Calendar Events",
    description: "Calendar Events",
    icon: Calendar,
  },
  "53": {
    id: "53",
    name: "Live Streaming",
    description: "Live Streaming and Spaces",
    icon: Radio,
  },
  "54": { id: "54", name: "Wiki", description: "Wiki", icon: FileText },
  "55": {
    id: "55",
    name: "Android Signer",
    description: "Android Signer Application",
    icon: Key,
  },
  "56": { id: "56", name: "Reporting", description: "Reporting", icon: Flag },
  "57": {
    id: "57",
    name: "Lightning Zaps",
    description: "Lightning zaps",
    icon: Zap,
  },
  "58": { id: "58", name: "Badges", description: "Badges", icon: Star },
  "59": { id: "59", name: "Gift Wrap", description: "Gift Wrap", icon: Gift },
  "60": {
    id: "60",
    name: "Cashu Wallet",
    description: "Cashu Wallet",
    icon: Wallet,
  },
  "61": { id: "61", name: "Nutzaps", description: "Nutzaps", icon: Zap },
  "62": {
    id: "62",
    name: "Request to Vanish",
    description: "Request to Vanish",
    icon: Eye,
  },
  "64": { id: "64", name: "Chess", description: "Chess (PGN)", icon: Gamepad2 },
  "65": {
    id: "65",
    name: "Relay List",
    description: "Relay list metadata",
    icon: Server,
  },
  "66": {
    id: "66",
    name: "Relay Discovery",
    description: "Relay Discovery",
    icon: Compass,
  },
  "67": {
    id: "67",
    name: "EOSE Hint",
    description: "EOSE Completeness Hint",
    icon: CheckCheck,
  },
  "68": {
    id: "68",
    name: "Picture-first",
    description: "Picture-first feeds",
    icon: Image,
  },
  "69": {
    id: "69",
    name: "P2P Order",
    description: "Peer-to-peer Order events",
    icon: ShoppingCart,
  },
  "70": {
    id: "70",
    name: "Protected Events",
    description: "Protected Events",
    icon: Shield,
  },
  "71": {
    id: "71",
    name: "Video Events",
    description: "Video Events",
    icon: Video,
  },
  "72": {
    id: "72",
    name: "Moderation",
    description: "Moderated communities",
    icon: Shield,
    deprecated: true,
  },
  "73": {
    id: "73",
    name: "External Content IDs",
    description: "External Content IDs",
    icon: Link,
  },
  "75": { id: "75", name: "Zap Goals", description: "Zap Goals", icon: Zap },
  "77": {
    id: "77",
    name: "Negentropy",
    description: "Negentropy Protocol Sync",
    icon: Server,
  },
  "78": {
    id: "78",
    name: "App Data",
    description: "Application-specific data",
    icon: Database,
  },
  "84": {
    id: "84",
    name: "Highlights",
    description: "Highlights",
    icon: Bookmark,
  },
  "85": {
    id: "85",
    name: "Trusted Assertions",
    description: "Trusted Assertions",
    icon: Shield,
  },
  "86": {
    id: "86",
    name: "Relay Management",
    description: "Relay Management API",
    icon: Server,
  },
  "87": {
    id: "87",
    name: "Ecash Mints",
    description: "Cashu and Fedimint Discoverability",
    icon: Coins,
  },
  "88": { id: "88", name: "Polls", description: "Polls", icon: Filter },
  "89": {
    id: "89",
    name: "App Handlers",
    description: "Recommended application handlers",
    icon: Package,
  },
  "90": {
    id: "90",
    name: "Data Vending",
    description: "Data Vending Machines",
    icon: Database,
    deprecated: true,
  },
  "92": {
    id: "92",
    name: "Media Attachments",
    description: "Media Attachments Metadata (imeta)",
    icon: Image,
  },
  "94": {
    id: "94",
    name: "File Metadata",
    description: "File metadata",
    icon: Image,
  },
  "96": {
    id: "96",
    name: "HTTP File Storage",
    description: "HTTP File Storage Integration",
    icon: Server,
    deprecated: true,
  },
  "98": {
    id: "98",
    name: "HTTP Auth",
    description: "HTTP authentication",
    icon: Lock,
  },
  "99": {
    id: "99",
    name: "Classified Listings",
    description: "Classified listings",
    icon: Tag,
  },

  // Hex NIPs (5A-EE)
  "5A": {
    id: "5A",
    name: "Static Websites",
    description: "Static Websites (nsites)",
    icon: Globe,
  },
  "5D": {
    id: "5D",
    name: "Web Applets",
    description: "Nostr Web Applets (napplets)",
    icon: Boxes,
  },
  "7D": {
    id: "7D",
    name: "Forum Threads",
    description: "Forum Threads",
    icon: MessageSquare,
  },
  A0: {
    id: "A0",
    name: "Voice Messages",
    description: "Voice Messages",
    icon: Music,
  },
  A4: {
    id: "A4",
    name: "Public Messages",
    description: "Public Messages",
    icon: MessageSquare,
  },
  B0: {
    id: "B0",
    name: "Web Bookmarks",
    description: "Web Bookmarks",
    icon: Bookmark,
  },
  B7: { id: "B7", name: "Blossom", description: "Blossom", icon: Package },
  BE: {
    id: "BE",
    name: "BLE",
    description: "BLE Communications",
    icon: Radio,
    deprecated: true,
  },
  C0: {
    id: "C0",
    name: "Code Snippets",
    description: "Code Snippets",
    icon: Code,
  },
  C7: {
    id: "C7",
    name: "Chats",
    description: "Chats",
    icon: MessageSquare,
  },
  CC: {
    id: "CC",
    name: "Geocaching",
    description: "Geocaching",
    icon: MapPin,
  },
  EE: {
    id: "EE",
    name: "E2EE MLS",
    description: "E2EE Messaging (MLS)",
    icon: Lock,
    deprecated: true,
  },
  F4: {
    id: "F4",
    name: "Podcasts",
    description: "Podcasts",
    icon: Podcast,
  },
};

/**
 * Get NIP metadata by identifier (handles both string IDs and numeric lookups)
 */
export function getNIPInfo(nipId: number | string): NIPInfo | undefined {
  const key = typeof nipId === "string" ? nipId : String(nipId);

  // Try direct lookup
  if (NIP_METADATA[key]) {
    return NIP_METADATA[key];
  }

  // Try hex conversion for numbers > 99
  if (typeof nipId === "number" && nipId > 99) {
    const hexKey = nipId.toString(16).toUpperCase();
    return NIP_METADATA[hexKey];
  }

  return undefined;
}
