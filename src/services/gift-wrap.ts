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
 * Validates that an event has all required NostrEvent properties
 */
function validateNostrEvent(event: any): void {
  if (!event || typeof event !== "object") {
    throw new GiftWrapError("Event is not an object", "INVALID_EVENT");
  }

  // Required string fields
  if (typeof event.id !== "string" || !/^[0-9a-f]{64}$/i.test(event.id)) {
    throw new GiftWrapError(
      `Invalid event.id: ${typeof event.id === "string" ? event.id.slice(0, 16) : typeof event.id}`,
      "INVALID_EVENT",
    );
  }

  if (
    typeof event.pubkey !== "string" ||
    !/^[0-9a-f]{64}$/i.test(event.pubkey)
  ) {
    throw new GiftWrapError(
      `Invalid event.pubkey: ${typeof event.pubkey === "string" ? event.pubkey.slice(0, 16) : typeof event.pubkey}`,
      "INVALID_EVENT",
    );
  }

  if (typeof event.sig !== "string" || !/^[0-9a-f]{128}$/i.test(event.sig)) {
    throw new GiftWrapError(
      `Invalid event.sig: ${typeof event.sig === "string" ? event.sig.slice(0, 16) : typeof event.sig}`,
      "INVALID_EVENT",
    );
  }

  // Required number fields
  if (typeof event.created_at !== "number" || event.created_at < 0) {
    throw new GiftWrapError(
      `Invalid event.created_at: ${event.created_at}`,
      "INVALID_EVENT",
    );
  }

  if (typeof event.kind !== "number") {
    throw new GiftWrapError(
      `Invalid event.kind: ${event.kind}`,
      "INVALID_EVENT",
    );
  }

  // Gift wrap specific validation
  if (event.kind !== 1059) {
    throw new GiftWrapError(
      `Expected kind 1059, got ${event.kind}`,
      "INVALID_KIND",
    );
  }

  // Required array field
  if (!Array.isArray(event.tags)) {
    throw new GiftWrapError("Event.tags is not an array", "INVALID_EVENT");
  }

  // Required string content (non-empty for gift wraps)
  if (typeof event.content !== "string" || event.content.trim() === "") {
    throw new GiftWrapError("Event.content is empty", "MISSING_CONTENT");
  }
}

/**
 * Unwraps a gift wrap and unseals to extract the rumor (full process)
 * Uses applesauce-common unlockGiftWrap helper
 *
 * @param giftWrap - Kind 1059 gift wrap event
 * @param signer - Signer for recipient (to decrypt)
 * @returns Object with seal and rumor
 */
export async function unwrapAndUnseal(
  giftWrap: NostrEvent,
  signer: ISigner,
): Promise<{ seal: NostrEvent; rumor: NostrEvent }> {
  // Validate event structure before attempting to decrypt
  validateNostrEvent(giftWrap);

  // Use applesauce helper to unlock the gift wrap
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
