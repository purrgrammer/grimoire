/**
 * NIP-59 Gift Wrap Service
 *
 * Handles unwrapping gift wraps (kind 1059) and unsealing seals (kind 13)
 * to extract encrypted rumors using applesauce helpers.
 *
 * Architecture:
 * 1. Gift Wrap (kind 1059) - outer layer with random ephemeral key
 * 2. Seal (kind 13) - middle layer with sender's real key
 * 3. Rumor - inner unsigned event with actual content
 *
 * See: https://github.com/nostr-protocol/nips/blob/master/59.md
 */

import type { NostrEvent } from "@/types/nostr";
import type { ISigner } from "applesauce-signers";
import { unlockGiftWrap, getGiftWrapSeal } from "applesauce-common/helpers";
import eventStore from "./event-store";
import db, {
  GiftWrapEnvelope,
  DecryptedRumor,
  ConversationMetadata,
} from "./db";

/**
 * Error thrown when gift wrap unwrapping fails
 */
export class GiftWrapError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_KIND"
      | "MISSING_CONTENT"
      | "DECRYPTION_FAILED"
      | "INVALID_SEAL"
      | "INVALID_RUMOR"
      | "INVALID_EVENT"
      | "NO_SIGNER",
  ) {
    super(message);
    this.name = "GiftWrapError";
  }
}

/**
 * Unwraps a gift wrap and unseals to extract the rumor (full process)
 * Uses applesauce-common unlockGiftWrap helper
 *
 * Note: Rumors are unsigned events (no sig field) - this is by design in NIP-59.
 * Applesauce caches the rumor on the gift wrap event object using symbols.
 *
 * IMPORTANT: The gift wrap event MUST be in the event store before calling this,
 * as applesauce uses the event store to cache and retrieve seals/rumors.
 *
 * @param giftWrap - Kind 1059 gift wrap event (must be in event store)
 * @param signer - Signer for recipient (to decrypt)
 * @returns Object with seal and rumor
 */
export async function unwrapAndUnseal(
  giftWrap: NostrEvent,
  signer: ISigner,
): Promise<{ seal: NostrEvent; rumor: NostrEvent }> {
  // Use applesauce helper to unlock the gift wrap
  // This caches the seal and rumor on the gift wrap event object via symbols
  const rumor = await unlockGiftWrap(giftWrap, signer);

  // Get the seal from the unlocked gift wrap
  const seal = getGiftWrapSeal(giftWrap);

  if (!seal) {
    throw new GiftWrapError(
      "Failed to extract seal from gift wrap",
      "INVALID_SEAL",
    );
  }

  // Convert rumor to NostrEvent (rumor has id but no sig)
  const rumorEvent = rumor as NostrEvent;

  return { seal, rumor: rumorEvent };
}

/**
 * Processes a gift wrap: unwraps, unseals, and stores in database
 *
 * @param giftWrap - Kind 1059 gift wrap event
 * @param recipientPubkey - The recipient's public key
 * @param signer - Signer for recipient (to decrypt)
 * @returns The decrypted rumor record from database
 */
export async function processGiftWrap(
  giftWrap: NostrEvent,
  recipientPubkey: string,
  signer: ISigner,
): Promise<DecryptedRumor | null> {
  // Check if already processed
  const existing = await db.giftWraps.get(giftWrap.id);
  if (existing) {
    // Already processed
    if (existing.status === "decrypted") {
      return (await db.decryptedRumors.get(giftWrap.id)) || null;
    }
    if (existing.status === "failed") {
      // Already tried and failed, don't retry
      return null;
    }
  }

  // CRITICAL: Ensure gift wrap is in event store before unlocking
  // Applesauce caches seal/rumor on the event object via symbols
  eventStore.add(giftWrap);

  // Store gift wrap envelope
  const envelope: GiftWrapEnvelope = {
    id: giftWrap.id,
    recipientPubkey,
    event: giftWrap,
    status: "pending",
    receivedAt: existing?.receivedAt || Date.now(),
    processedAt: Date.now(),
  };

  try {
    // Unwrap and unseal
    const { seal, rumor } = await unwrapAndUnseal(giftWrap, signer);

    // Store decrypted rumor
    const decryptedRumor: DecryptedRumor = {
      giftWrapId: giftWrap.id,
      recipientPubkey,
      senderPubkey: seal.pubkey,
      seal,
      rumor,
      rumorCreatedAt: rumor.created_at,
      rumorKind: rumor.kind,
      decryptedAt: Date.now(),
    };

    // Update envelope status
    envelope.status = "decrypted";
    await db.giftWraps.put(envelope);

    // Store decrypted rumor
    await db.decryptedRumors.put(decryptedRumor);

    // Update conversation metadata
    await updateConversationMetadata(decryptedRumor);

    return decryptedRumor;
  } catch (error) {
    // Store failure
    envelope.status = "failed";
    envelope.failureReason =
      error instanceof Error ? error.message : String(error);
    await db.giftWraps.put(envelope);

    return null;
  }
}

/**
 * Updates conversation metadata after processing a new message
 */
async function updateConversationMetadata(
  rumor: DecryptedRumor,
): Promise<void> {
  const conversationId = `${rumor.senderPubkey}:${rumor.recipientPubkey}`;

  const existing = await db.conversations.get(conversationId);

  // Get content preview (first 100 chars)
  const preview = rumor.rumor.content.slice(0, 100);

  if (!existing) {
    // Create new conversation
    const conversation: ConversationMetadata = {
      id: conversationId,
      senderPubkey: rumor.senderPubkey,
      recipientPubkey: rumor.recipientPubkey,
      lastMessageGiftWrapId: rumor.giftWrapId,
      lastMessageCreatedAt: rumor.rumorCreatedAt,
      lastMessagePreview: preview,
      lastMessageKind: rumor.rumorKind,
      messageCount: 1,
      unreadCount: 1,
      updatedAt: Date.now(),
    };
    await db.conversations.put(conversation);
  } else {
    // Update existing conversation if this is newer
    if (rumor.rumorCreatedAt > existing.lastMessageCreatedAt) {
      const conversation: ConversationMetadata = {
        ...existing,
        lastMessageGiftWrapId: rumor.giftWrapId,
        lastMessageCreatedAt: rumor.rumorCreatedAt,
        lastMessagePreview: preview,
        lastMessageKind: rumor.rumorKind,
        messageCount: existing.messageCount + 1,
        unreadCount: existing.unreadCount + 1,
        updatedAt: Date.now(),
      };
      await db.conversations.put(conversation);
    } else {
      // Just increment message count for older messages
      existing.messageCount++;
      await db.conversations.put(existing);
    }
  }
}

/**
 * Gets all conversations for a recipient, sorted by most recent
 */
export async function getConversations(
  recipientPubkey: string,
): Promise<ConversationMetadata[]> {
  return db.conversations
    .where("recipientPubkey")
    .equals(recipientPubkey)
    .reverse()
    .sortBy("lastMessageCreatedAt");
}

/**
 * Gets all decrypted messages in a conversation
 */
export async function getConversationMessages(
  recipientPubkey: string,
  senderPubkey: string,
): Promise<DecryptedRumor[]> {
  return db.decryptedRumors
    .where("[recipientPubkey+senderPubkey]")
    .equals([recipientPubkey, senderPubkey])
    .sortBy("rumorCreatedAt");
}

/**
 * Marks a conversation as read
 */
export async function markConversationAsRead(
  recipientPubkey: string,
  senderPubkey: string,
): Promise<void> {
  const conversationId = `${senderPubkey}:${recipientPubkey}`;
  const conversation = await db.conversations.get(conversationId);

  if (conversation) {
    conversation.unreadCount = 0;
    conversation.updatedAt = Date.now();
    await db.conversations.put(conversation);
  }
}

/**
 * Gets all pending gift wraps that need processing
 */
export async function getPendingGiftWraps(
  recipientPubkey: string,
): Promise<GiftWrapEnvelope[]> {
  return db.giftWraps
    .where("[recipientPubkey+status]")
    .equals([recipientPubkey, "pending"])
    .toArray();
}
