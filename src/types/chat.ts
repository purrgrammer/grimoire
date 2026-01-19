import type { NostrEvent } from "./nostr";

/**
 * Event kinds that are considered chat messages across all protocols
 * Used for filtering and validating chat-related events
 */
export const CHAT_KINDS = [
  9, // NIP-29: Group chat messages
  9321, // NIP-61: Nutzaps (ecash zaps in groups/live chats)
  1311, // NIP-53: Live chat messages
  9735, // NIP-57: Zap receipts (part of chat context)
] as const;

/**
 * Chat protocol identifier
 */
export type ChatProtocol =
  | "nip-c7"
  | "nip-17"
  | "nip-28"
  | "nip-29"
  | "nip-53"
  | "nip-10";

/**
 * Conversation type
 */
export type ConversationType = "dm" | "channel" | "group" | "live-chat";

/**
 * Participant role in a conversation
 */
export type ParticipantRole = "admin" | "moderator" | "member" | "host" | "op";

/**
 * Participant in a conversation
 */
export interface Participant {
  pubkey: string;
  role?: ParticipantRole;
  permissions?: string[];
}

/**
 * Live activity metadata for NIP-53
 */
export interface LiveActivityMetadata {
  status: "planned" | "live" | "ended";
  streaming?: string;
  recording?: string;
  starts?: number;
  ends?: number;
  hostPubkey: string;
  currentParticipants?: number;
  totalParticipants?: number;
  hashtags: string[];
  relays: string[];
  goal?: string; // Event ID of a kind 9041 zap goal
}

/**
 * Protocol-specific conversation metadata
 */
export interface ConversationMetadata {
  // NIP-28 channel
  channelEvent?: NostrEvent; // kind 40 creation event

  // NIP-29 group
  groupId?: string; // host'group-id format
  relayUrl?: string; // Relay URL for single-relay protocols
  description?: string; // Group/thread description
  icon?: string; // Group icon/picture URL

  // NIP-53 live chat
  activityAddress?: {
    kind: number;
    pubkey: string;
    identifier: string;
  };
  liveActivity?: LiveActivityMetadata;

  // NIP-17 DM
  encrypted?: boolean;
  giftWrapped?: boolean;

  // NIP-10 thread
  rootEventId?: string; // Thread root event ID
  providedEventId?: string; // Original event from nevent (may be reply)
  threadDepth?: number; // Approximate depth of thread
  relays?: string[]; // Relays for this conversation
}

/**
 * Generic conversation abstraction
 * Works across all messaging protocols
 */
export interface Conversation {
  id: string; // Protocol-specific identifier
  type: ConversationType;
  protocol: ChatProtocol;
  title: string;
  participants: Participant[];
  metadata?: ConversationMetadata;
  lastMessage?: Message;
  unreadCount: number;
}

/**
 * Message metadata (reactions, zaps, encryption status, etc.)
 */
export interface MessageMetadata {
  encrypted?: boolean;
  reactions?: NostrEvent[];
  zaps?: NostrEvent[];
  deleted?: boolean;
  hidden?: boolean; // NIP-28 channel hide
  // Zap-specific metadata (for type: "zap" messages)
  zapAmount?: number; // Amount in sats
  zapRecipient?: string; // Pubkey of zap recipient
  // NIP-61 nutzap-specific metadata
  nutzapUnit?: string; // Unit for nutzap amount (sat, usd, eur, etc.)
}

/**
 * Message type - system messages for events like join/leave, user messages for chat, zaps for stream tips
 */
export type MessageType = "user" | "system" | "zap";

/**
 * Generic message abstraction
 * Works across all messaging protocols
 */
export interface Message {
  id: string;
  conversationId: string;
  author: string; // pubkey
  content: string;
  timestamp: number;
  type?: MessageType; // Defaults to "user" if not specified
  replyTo?: string; // Parent message ID
  metadata?: MessageMetadata;
  protocol: ChatProtocol;
  event: NostrEvent; // Original Nostr event for verification
}

/**
 * NIP-29 group identifier
 */
export interface GroupIdentifier {
  type: "group";
  /** Group ID (e.g., "bitcoin-dev") */
  value: string;
  /** Relay URL where the group is hosted (required for NIP-29) */
  relays: string[];
}

/**
 * NIP-53 live activity identifier
 */
export interface LiveActivityIdentifier {
  type: "live-activity";
  /** Address pointer for the live activity */
  value: {
    kind: 30311;
    pubkey: string;
    identifier: string;
  };
  /** Relay hints from naddr encoding */
  relays?: string[];
}

/**
 * NIP-C7/NIP-17 direct message identifier (resolved pubkey)
 */
export interface DMIdentifier {
  type: "dm-recipient" | "chat-partner";
  /** Recipient pubkey (hex) */
  value: string;
  /** Relay hints */
  relays?: string[];
}

/**
 * NIP-C7 NIP-05 identifier (needs resolution)
 */
export interface NIP05Identifier {
  type: "chat-partner-nip05";
  /** NIP-05 address to resolve */
  value: string;
  /** Relay hints */
  relays?: string[];
}

/**
 * NIP-28 channel identifier (future)
 */
export interface ChannelIdentifier {
  type: "channel";
  /** Channel creation event ID or address */
  value: string;
  /** Relay hints */
  relays?: string[];
}

/**
 * Group list identifier (kind 10009)
 * Used to open multi-room chat interface
 */
export interface GroupListIdentifier {
  type: "group-list";
  /** Address pointer for the group list (kind 10009) */
  value: {
    kind: 10009;
    pubkey: string;
    identifier: string;
  };
  /** Relay hints from naddr encoding */
  relays?: string[];
}

/**
 * NIP-10 thread identifier (kind 1 note thread)
 */
export interface ThreadIdentifier {
  type: "thread";
  /** Event pointer to the provided event (may be root or a reply) */
  value: {
    id: string;
    relays?: string[];
    author?: string;
    kind?: number;
  };
  /** Relay hints from nevent encoding */
  relays?: string[];
}

/**
 * Protocol-specific identifier - discriminated union
 * Returned by adapter parseIdentifier()
 */
export type ProtocolIdentifier =
  | GroupIdentifier
  | LiveActivityIdentifier
  | DMIdentifier
  | NIP05Identifier
  | ChannelIdentifier
  | GroupListIdentifier
  | ThreadIdentifier;

/**
 * Chat command parsing result
 */
export interface ChatCommandResult {
  protocol: ChatProtocol;
  identifier: ProtocolIdentifier;
  adapter: any; // Will be ChatProtocolAdapter but avoiding circular dependency
}

/**
 * Message loading options
 */
export interface LoadMessagesOptions {
  limit?: number;
  before?: number; // Unix timestamp
  after?: number; // Unix timestamp
}

/**
 * Conversation creation parameters
 */
export interface CreateConversationParams {
  type: ConversationType;
  title?: string;
  participants: string[]; // pubkeys
  metadata?: Record<string, any>;
}

/**
 * Chat capabilities - what features a protocol supports
 */
export interface ChatCapabilities {
  supportsEncryption: boolean;
  supportsThreading: boolean;
  supportsModeration: boolean;
  supportsRoles: boolean;
  supportsGroupManagement: boolean;
  canCreateConversations: boolean;
  requiresRelay: boolean;
}
