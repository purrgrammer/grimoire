import type { Observable, Subscription } from "rxjs";
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
import type {
  ChatAction,
  ChatActionContext,
  ChatActionResult,
  GetActionsOptions,
} from "@/types/chat-actions";

/**
 * Blob attachment metadata for imeta tags (NIP-92)
 */
export interface BlobAttachmentMeta {
  /** The URL of the blob */
  url: string;
  /** SHA256 hash of the blob content */
  sha256: string;
  /** MIME type of the blob */
  mimeType?: string;
  /** Size in bytes */
  size?: number;
  /** Blossom server URL */
  server?: string;
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** Event ID being replied to */
  replyTo?: string;
  /** NIP-30 custom emoji tags */
  emojiTags?: Array<{ shortcode: string; url: string }>;
  /** Blob attachments for imeta tags (NIP-92) */
  blobAttachments?: BlobAttachmentMeta[];
}

/**
 * Abstract base class for all chat protocol adapters
 *
 * Each adapter implements protocol-specific logic for:
 * - Identifier parsing and resolution
 * - Message loading and sending
 * - Conversation management
 * - Protocol capabilities
 *
 * Adapters manage their own relay subscriptions. Call cleanup() when
 * a conversation is closed to prevent memory leaks.
 */
export abstract class ChatProtocolAdapter {
  abstract readonly protocol: ChatProtocol;
  abstract readonly type: ConversationType;

  /** Active relay subscriptions by conversation ID */
  protected subscriptions = new Map<string, Subscription>();

  /**
   * Cleanup subscriptions for a specific conversation
   * Should be called when a chat window is closed
   */
  cleanup(conversationId: string): void {
    const sub = this.subscriptions.get(conversationId);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(conversationId);
    }
  }

  /**
   * Cleanup all subscriptions
   * Should be called when the adapter is no longer needed
   */
  cleanupAll(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.clear();
  }

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
   * Send a reaction (kind 7) to a message
   * @param conversation - The conversation context
   * @param messageId - The event ID being reacted to
   * @param emoji - The reaction emoji (unicode or :shortcode:)
   * @param customEmoji - Optional NIP-30 custom emoji metadata
   */
  abstract sendReaction(
    conversation: Conversation,
    messageId: string,
    emoji: string,
    customEmoji?: { shortcode: string; url: string },
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

  /**
   * Get available actions for this protocol
   * Actions are protocol-specific slash commands like /join, /leave, etc.
   * Can be filtered based on conversation and user context
   * Returns empty array by default
   */
  getActions(_options?: GetActionsOptions): ChatAction[] {
    return [];
  }

  /**
   * Execute a chat action by name
   * Returns error if action not found
   */
  async executeAction(
    actionName: string,
    context: ChatActionContext,
  ): Promise<ChatActionResult> {
    // Get actions with context for validation
    const action = this.getActions({
      conversation: context.conversation,
      activePubkey: context.activePubkey,
    }).find((a) => a.name === actionName);

    if (!action) {
      return {
        success: false,
        message: `Unknown action: /${actionName}`,
      };
    }

    return action.handler(context);
  }
}
