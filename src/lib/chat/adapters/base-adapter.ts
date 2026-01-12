import type { Observable } from "rxjs";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  ChatProtocol,
  ConversationType,
  LoadMessagesOptions,
  CreateConversationParams,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** Event ID being replied to */
  replyTo?: string;
  /** NIP-30 custom emoji tags */
  emojiTags?: Array<{ shortcode: string; url: string }>;
}

/**
 * Abstract base class for all chat protocol adapters
 *
 * Each adapter implements protocol-specific logic for:
 * - Identifier parsing and resolution
 * - Message loading and sending
 * - Conversation management
 * - Protocol capabilities
 */
export abstract class ChatProtocolAdapter {
  abstract readonly protocol: ChatProtocol;
  abstract readonly type: ConversationType;

  /**
   * Parse an identifier string to determine if this adapter can handle it
   * Returns null if the identifier doesn't match this protocol
   */
  abstract parseIdentifier(input: string): ProtocolIdentifier | null;

  /**
   * Resolve a protocol identifier into a full Conversation object
   * May involve fetching metadata from relays
   */
  abstract resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation>;

  /**
   * Load messages for a conversation
   * Returns an Observable that emits message arrays as they arrive
   */
  abstract loadMessages(
    conversation: Conversation,
    options?: LoadMessagesOptions,
  ): Observable<Message[]>;

  /**
   * Load more historical messages (pagination)
   */
  abstract loadMoreMessages(
    conversation: Conversation,
    before: number,
  ): Promise<Message[]>;

  /**
   * Send a message to a conversation
   * Returns when the message has been published
   */
  abstract sendMessage(
    conversation: Conversation,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void>;

  /**
   * Get the capabilities of this protocol
   * Used to determine which UI features to show
   */
  abstract getCapabilities(): ChatCapabilities;

  /**
   * Load a replied-to message by ID
   * First checks EventStore, then fetches from protocol-specific relays if needed
   * Returns null if event cannot be loaded
   */
  abstract loadReplyMessage(
    conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null>;

  /**
   * Load list of all conversations for this protocol
   * Optional - not all protocols support conversation lists
   */
  loadConversationList?(): Observable<Conversation[]>;

  /**
   * Create a new conversation
   * Optional - not all protocols support creation
   */
  createConversation?(params: CreateConversationParams): Promise<Conversation>;

  /**
   * Join an existing conversation
   * Optional - only for protocols with join semantics (groups)
   */
  joinConversation?(conversation: Conversation): Promise<void>;

  /**
   * Leave a conversation
   * Optional - only for protocols with leave semantics (groups)
   */
  leaveConversation?(conversation: Conversation): Promise<void>;
}
