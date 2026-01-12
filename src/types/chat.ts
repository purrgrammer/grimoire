import type { NostrEvent } from "./nostr";

/**
 * Chat protocol identifier
 */
export type ChatProtocol = "nip-c7" | "nip-17" | "nip-28" | "nip-29" | "nip-53";

/**
 * Conversation type
 */
export type ConversationType = "dm" | "channel" | "group" | "live-chat";

/**
 * Participant role in a conversation
 */
export type ParticipantRole = "admin" | "moderator" | "member" | "host";

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
}

/**
 * Protocol-specific conversation metadata
 */
export interface ConversationMetadata {
  // NIP-28 channel
  channelEvent?: NostrEvent; // kind 40 creation event

  // NIP-29 group
  groupId?: string; // host'group-id format
  relayUrl?: string; // Relay enforcing group rules
  description?: string; // Group description
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
 * Protocol-specific identifier
 * Returned by adapter parseIdentifier()
 */
export interface ProtocolIdentifier {
  type: string; // e.g., 'dm-recipient', 'channel-event', 'group-id'
  value: any; // Protocol-specific value
  relays?: string[]; // Relay hints from bech32 encoding
}

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
