/**
 * NIP-17 Adapter - Private Direct Messages (Gift Wrapped)
 *
 * Implements NIP-17 encrypted DMs using NIP-59 gift wraps.
 * Delegates gift wrap management to the global GiftWrapService.
 *
 * This adapter handles:
 * - Parsing DM identifiers (npub, nprofile, hex, NIP-05, $me)
 * - Filtering kind 14 rumors from decrypted gift wraps
 * - Converting rumors to messages
 * - Sending gift-wrapped messages
 *
 * Gift wrap subscription and decryption is managed globally by GiftWrapService.
 */
import { Observable, BehaviorSubject, firstValueFrom } from "rxjs";
import { map, distinctUntilChanged } from "rxjs/operators";
import { nip19 } from "nostr-tools";
import { ChatProtocolAdapter, type SendMessageOptions } from "./base-adapter";
import type {
  Conversation,
  Message,
  ProtocolIdentifier,
  ChatCapabilities,
  LoadMessagesOptions,
} from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";
import { hub } from "@/services/hub";
import { giftWrapService } from "@/services/gift-wrap-service";
import { isNip05, resolveNip05 } from "@/lib/nip05";
import { getDisplayName } from "@/lib/nostr-utils";
import { isValidHexPubkey } from "@/lib/nostr-validation";
import { getProfileContent } from "applesauce-core/helpers";
import {
  getGiftWrapRumor,
  getConversationParticipants,
  getConversationIdentifierFromMessage,
  type Rumor,
} from "applesauce-common/helpers";
import { SendWrappedMessage } from "applesauce-actions/actions";

const DM_RUMOR_KIND = 14;

/**
 * NIP-17 Adapter - Gift Wrapped Private DMs
 *
 * Requires GiftWrapService to be enabled for subscription and decryption.
 */
export class Nip17Adapter extends ChatProtocolAdapter {
  readonly protocol = "nip-17" as const;
  readonly type = "dm" as const;

  /**
   * Check if gift wrap service is enabled (required for NIP-17)
   */
  isAvailable(): boolean {
    return giftWrapService.isEnabled();
  }

  /**
   * Observable of whether NIP-17 is available
   */
  isAvailable$(): Observable<boolean> {
    return giftWrapService.isEnabled$();
  }

  /**
   * Parse identifier - accepts npub, nprofile, hex pubkey, NIP-05, or $me
   */
  parseIdentifier(input: string): ProtocolIdentifier | null {
    // Handle $me alias for saved messages (DMs to yourself)
    if (input.toLowerCase() === "$me") {
      return {
        type: "dm-self",
        value: "$me",
      };
    }

    // Try bech32 decoding (npub/nprofile)
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "npub") {
        return {
          type: "dm-recipient",
          value: decoded.data,
        };
      }
      if (decoded.type === "nprofile") {
        return {
          type: "dm-recipient",
          value: decoded.data.pubkey,
          relays: decoded.data.relays,
        };
      }
    } catch {
      // Not bech32, try other formats
    }

    // Try hex pubkey
    if (isValidHexPubkey(input)) {
      return {
        type: "dm-recipient",
        value: input,
      };
    }

    // Try NIP-05
    if (isNip05(input)) {
      return {
        type: "chat-partner-nip05",
        value: input,
      };
    }

    return null;
  }

  /**
   * Resolve conversation from identifier
   */
  async resolveConversation(
    identifier: ProtocolIdentifier,
  ): Promise<Conversation> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    if (!giftWrapService.isEnabled()) {
      throw new Error(
        "Gift wrap subscription is not enabled. Enable it in settings to use NIP-17 DMs.",
      );
    }

    let partnerPubkey: string;

    // Handle $me (saved messages - DMs to yourself)
    if (identifier.type === "dm-self") {
      partnerPubkey = activePubkey;
    } else if (identifier.type === "chat-partner-nip05") {
      // Resolve NIP-05
      const resolved = await resolveNip05(identifier.value);
      if (!resolved) {
        throw new Error(`Failed to resolve NIP-05: ${identifier.value}`);
      }
      partnerPubkey = resolved;
    } else if (
      identifier.type === "dm-recipient" ||
      identifier.type === "chat-partner"
    ) {
      partnerPubkey = identifier.value;
    } else {
      throw new Error(
        `NIP-17 adapter cannot handle identifier type: ${identifier.type}`,
      );
    }

    // Check if this is a self-conversation (saved messages)
    const isSelf = partnerPubkey === activePubkey;
    const title = isSelf
      ? "Saved Messages"
      : await this.getPartnerTitle(partnerPubkey);

    // Create conversation ID from sorted participants (deterministic)
    const participants = isSelf
      ? [activePubkey]
      : [activePubkey, partnerPubkey].sort();
    const conversationId = `nip-17:${participants.join(",")}`;

    return {
      id: conversationId,
      type: "dm",
      protocol: "nip-17",
      title,
      participants: isSelf
        ? [{ pubkey: activePubkey, role: "member" }]
        : [
            { pubkey: activePubkey, role: "member" },
            { pubkey: partnerPubkey, role: "member" },
          ],
      metadata: {
        encrypted: true,
        giftWrapped: true,
        isSavedMessages: isSelf,
      },
      unreadCount: 0,
    };
  }

  /**
   * Get display name for a partner pubkey
   */
  private async getPartnerTitle(pubkey: string): Promise<string> {
    const metadataEvent = await this.getMetadata(pubkey);
    const metadata = metadataEvent
      ? getProfileContent(metadataEvent)
      : undefined;
    return getDisplayName(pubkey, metadata);
  }

  /**
   * Load messages for a conversation
   * Filters decrypted gift wraps from GiftWrapService for kind 14 rumors
   */
  loadMessages(
    conversation: Conversation,
    _options?: LoadMessagesOptions,
  ): Observable<Message[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      throw new Error("No active account");
    }

    // Check if this is a self-conversation (saved messages)
    const isSelfConversation =
      conversation.metadata?.isSavedMessages ||
      (conversation.participants.length === 1 &&
        conversation.participants[0].pubkey === activePubkey);

    // Get partner pubkey (for self-conversation, partner is self)
    const partnerPubkey = isSelfConversation
      ? activePubkey
      : conversation.participants.find((p) => p.pubkey !== activePubkey)
          ?.pubkey;

    if (!partnerPubkey) {
      throw new Error("No conversation partner found");
    }

    // Expected participants for this conversation
    const expectedParticipants = isSelfConversation
      ? [activePubkey]
      : [activePubkey, partnerPubkey].sort();

    // Get decrypted gift wraps from the global service and filter to kind 14 DMs
    return giftWrapService.getDecryptedGiftWraps$().pipe(
      map((giftWraps) => {
        const messages: Message[] = [];

        for (const gift of giftWraps) {
          try {
            const rumor = getGiftWrapRumor(gift);
            if (!rumor) continue;

            // Only kind 14 DM rumors
            if (rumor.kind !== DM_RUMOR_KIND) continue;

            // Get participants from rumor
            const rumorParticipants = getConversationParticipants(rumor);

            // For self-conversations, all participants should be the same
            if (isSelfConversation) {
              const allSelf = rumorParticipants.every(
                (p) => p === activePubkey,
              );
              if (!allSelf) continue;
            } else {
              // Check if participants match this conversation
              const sortedRumorParticipants = rumorParticipants.sort();
              if (
                sortedRumorParticipants.length !==
                  expectedParticipants.length ||
                !sortedRumorParticipants.every(
                  (p, i) => p === expectedParticipants[i],
                )
              ) {
                continue;
              }
            }

            messages.push(this.rumorToMessage(rumor, conversation.id));
          } catch (error) {
            console.warn(
              `[NIP-17] Failed to get rumor from gift wrap ${gift.id}:`,
              error,
            );
          }
        }

        // Sort by timestamp
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((m, i) => m.id === b[i].id),
      ),
    );
  }

  /**
   * Load more historical messages (pagination)
   */
  async loadMoreMessages(
    _conversation: Conversation,
    _before: number,
  ): Promise<Message[]> {
    // Gift wraps don't paginate well since we need to decrypt all
    return [];
  }

  /**
   * Send a gift-wrapped DM
   */
  async sendMessage(
    conversation: Conversation,
    content: string,
    _options?: SendMessageOptions,
  ): Promise<void> {
    const activePubkey = accountManager.active$.value?.pubkey;
    const activeSigner = accountManager.active$.value?.signer;

    if (!activePubkey || !activeSigner) {
      throw new Error("No active account or signer");
    }

    // Check if this is a self-conversation (saved messages)
    const isSelfConversation =
      conversation.metadata?.isSavedMessages ||
      (conversation.participants.length === 1 &&
        conversation.participants[0].pubkey === activePubkey);

    // Get recipient pubkey (for self-conversation, it's ourselves)
    const recipientPubkey = isSelfConversation
      ? activePubkey
      : conversation.participants.find((p) => p.pubkey !== activePubkey)
          ?.pubkey;

    if (!recipientPubkey) {
      throw new Error("No conversation recipient found");
    }

    // Use applesauce's SendWrappedMessage action
    await hub.run(SendWrappedMessage, recipientPubkey, content);

    console.log(
      `[NIP-17] Sent wrapped message to ${recipientPubkey.slice(0, 8)}...${isSelfConversation ? " (saved)" : ""}`,
    );
  }

  /**
   * Get protocol capabilities
   */
  getCapabilities(): ChatCapabilities {
    return {
      supportsEncryption: true,
      supportsThreading: true,
      supportsModeration: false,
      supportsRoles: false,
      supportsGroupManagement: false,
      canCreateConversations: true,
      requiresRelay: false,
    };
  }

  /**
   * Load a replied-to message
   */
  async loadReplyMessage(
    _conversation: Conversation,
    eventId: string,
  ): Promise<NostrEvent | null> {
    // Check decrypted gift wraps for a rumor matching this ID
    const giftWraps = await firstValueFrom(
      giftWrapService.getDecryptedGiftWraps$(),
    );

    for (const gift of giftWraps) {
      try {
        const rumor = getGiftWrapRumor(gift);
        if (rumor && rumor.id === eventId) {
          return { ...rumor, sig: "" } as NostrEvent;
        }
      } catch {
        // Skip
      }
    }

    return null;
  }

  /**
   * Get all conversations from decrypted kind 14 rumors
   */
  getConversations$(): Observable<Conversation[]> {
    const activePubkey = accountManager.active$.value?.pubkey;
    if (!activePubkey) {
      return new BehaviorSubject([]);
    }

    return giftWrapService.getDecryptedGiftWraps$().pipe(
      map((giftWraps) => {
        // Group rumors by conversation
        const conversationMap = new Map<
          string,
          { participants: string[]; lastRumor: Rumor }
        >();

        for (const gift of giftWraps) {
          try {
            const rumor = getGiftWrapRumor(gift);
            if (!rumor) continue;
            if (rumor.kind !== DM_RUMOR_KIND) continue;

            const convId = getConversationIdentifierFromMessage(rumor);
            const participants = getConversationParticipants(rumor);

            const existing = conversationMap.get(convId);
            if (!existing || rumor.created_at > existing.lastRumor.created_at) {
              conversationMap.set(convId, { participants, lastRumor: rumor });
            }
          } catch {
            // Skip invalid gift wraps
          }
        }

        // Convert to Conversation objects
        const conversations: Conversation[] = [];

        for (const [convId, { participants, lastRumor }] of conversationMap) {
          const isSelfConversation = participants.every(
            (p) => p === activePubkey,
          );

          const partnerPubkey = isSelfConversation
            ? activePubkey
            : participants.find((p) => p !== activePubkey);

          if (!partnerPubkey) continue;

          const uniqueParticipants = isSelfConversation
            ? [activePubkey]
            : participants.sort();

          conversations.push({
            id: `nip-17:${uniqueParticipants.join(",")}`,
            type: "dm",
            protocol: "nip-17",
            title: isSelfConversation
              ? "Saved Messages"
              : partnerPubkey.slice(0, 8) + "...",
            participants: isSelfConversation
              ? [{ pubkey: activePubkey, role: "member" as const }]
              : participants.map((p) => ({
                  pubkey: p,
                  role: "member" as const,
                })),
            metadata: {
              encrypted: true,
              giftWrapped: true,
              isSavedMessages: isSelfConversation,
            },
            lastMessage: this.rumorToMessage(lastRumor, convId),
            unreadCount: 0,
          });
        }

        // Sort: Saved Messages at top, then by last message timestamp
        conversations.sort((a, b) => {
          if (a.metadata?.isSavedMessages && !b.metadata?.isSavedMessages)
            return -1;
          if (!a.metadata?.isSavedMessages && b.metadata?.isSavedMessages)
            return 1;
          return (
            (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)
          );
        });

        return conversations;
      }),
    );
  }

  /**
   * Get inbox relays for a pubkey (delegates to GiftWrapService)
   */
  async getInboxRelays(pubkey: string): Promise<string[]> {
    return giftWrapService.getInboxRelays(pubkey);
  }

  // ==================== Private Methods ====================

  /**
   * Convert a rumor to a Message
   */
  private rumorToMessage(rumor: Rumor, conversationId: string): Message {
    const replyTag = rumor.tags.find(
      (t) => t[0] === "e" && (t[3] === "reply" || !t[3]),
    );
    const replyTo = replyTag?.[1];

    return {
      id: rumor.id,
      conversationId,
      author: rumor.pubkey,
      content: rumor.content,
      timestamp: rumor.created_at,
      type: "user",
      replyTo,
      protocol: "nip-17",
      metadata: {
        encrypted: true,
      },
      event: { ...rumor, sig: "" } as NostrEvent,
    };
  }

  /**
   * Get metadata for a pubkey
   */
  private async getMetadata(pubkey: string): Promise<NostrEvent | undefined> {
    return firstValueFrom(eventStore.replaceable(0, pubkey), {
      defaultValue: undefined,
    });
  }
}

/**
 * Singleton instance for shared state across the app
 */
export const nip17Adapter = new Nip17Adapter();
