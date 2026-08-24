import { HexIcon } from "@/components/ai/Hex";
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
  MessagesSquare,
  Bot,
  Phone,
  Hash,
  Zap,
  Boxes,
  Globe,
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
  // Hex has a face rather than a glyph; the wrapper matches the lucide shape.
  ai: {
    icon: HexIcon as unknown as LucideIcon,
    description: "Ask Hex, grimoire's assistant",
  },
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
  app: {
    icon: Boxes,
    description: "Run a sandboxed NIP-5D napplet",
  },
  apps: {
    icon: Boxes,
    description: "Find and launch napplets",
  },
  // Not a command — an appId. `app` opens either, and the window's icon should
  // say which one it got.
  nsite: {
    icon: Globe,
    description: "A NIP-5A nsite, verified and served locally",
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
  agent: {
    icon: Bot,
    description: "Read an agent's transcript, as it published it",
  },
  concord: {
    icon: MessagesSquare,
    description: "Browse your end-to-end encrypted Concord communities",
  },
  call: {
    icon: Phone,
    description: "The end-to-end encrypted call in a Concord channel",
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
