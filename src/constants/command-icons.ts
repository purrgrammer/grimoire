import {
  Book,
  Podcast,
  FileText,
  HelpCircle,
  List,
  BookOpen,
  ExternalLink,
  User,
  Lock,
  Unlock,
  Radio,
  Rss,
  Layout,
  Bug,
  Wifi,
  MessageSquare,
  Hash,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon mapping for all commands/apps
 * Each command has an icon and optional tooltip description
 */
export interface CommandIcon {
  icon: LucideIcon;
  description: string;
}

export const COMMAND_ICONS: Record<string, CommandIcon> = {
  // Documentation commands
  nip: {
    icon: Book,
    description: "View Nostr Implementation Possibility specification",
  },
  kind: {
    icon: FileText,
    description: "View information about a Nostr event kind",
  },
  kinds: {
    icon: List,
    description: "Display all supported Nostr event kinds",
  },
  man: {
    icon: BookOpen,
    description: "Display manual page for a command",
  },
  help: {
    icon: HelpCircle,
    description: "Display general help information",
  },

  // Nostr commands
  req: {
    icon: Podcast,
    description: "Active subscription to Nostr relays with filters",
  },
  count: {
    icon: Hash,
    description: "Count events on relays using NIP-45 COUNT verb",
  },
  open: {
    icon: ExternalLink,
    description: "Open and view a Nostr event",
  },
  profile: {
    icon: User,
    description: "View a Nostr user profile",
  },
  relay: {
    icon: Radio,
    description: "View relay information and statistics",
  },
  feed: {
    icon: Rss,
    description: "View event feed",
  },
  chat: {
    icon: MessageSquare,
    description: "Join and participate in NIP-29 relay-based group chats",
  },
  zap: {
    icon: Zap,
    description: "Send a Lightning zap to a Nostr user or event",
  },

  // Utility commands
  encode: {
    icon: Lock,
    description: "Encode data to NIP-19 format",
  },
  decode: {
    icon: Unlock,
    description: "Decode NIP-19 encoded identifiers",
  },

  // System commands
  win: {
    icon: Layout,
    description: "View all open windows",
  },
  debug: {
    icon: Bug,
    description: "Display application state for debugging",
  },
  conn: {
    icon: Wifi,
    description: "View relay pool connection and authentication status",
  },
};

export function getCommandIcon(command: string): LucideIcon {
  return COMMAND_ICONS[command]?.icon || FileText;
}

export function getCommandDescription(command: string): string {
  return COMMAND_ICONS[command]?.description || "";
}
