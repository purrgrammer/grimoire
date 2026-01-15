/**
 * NIP-59 Gift Wrap Service
 *
 * Handles unwrapping gift wraps (kind 1059) and unsealing seals (kind 13)
 * to extract encrypted rumors.
 *
 * Architecture:
 * 1. Gift Wrap (kind 1059) - outer layer with random ephemeral key
 * 2. Seal (kind 13) - middle layer with sender's real key
 * 3. Rumor - inner unsigned event with actual content
 *
 * See: https://github.com/nostr-protocol/nips/blob/master/59.md
 */

import type { NostrEvent } from "@/types/nostr";
import type { Signer } from "applesauce-signers";
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
      | "NO_SIGNER",
  ) {
    super(message);
    this.name = "GiftWrapError";
  }
}

/**
 * Validates that an event is a gift wrap (kind 1059)
 */
function validateGiftWrap(event: NostrEvent): void {
  if (event.kind !== 1059) {
    throw new GiftWrapError(
      `Expected kind 1059, got ${event.kind}`,
      "INVALID_KIND",
    );
  }

  if (!event.content || event.content.trim() === "") {
    throw new GiftWrapError("Gift wrap content is empty", "MISSING_CONTENT");
  }
}

/**
 * Validates that an event is a seal (kind 13)
 */
function validateSeal(event: NostrEvent): void {
  if (event.kind !== 13) {
    throw new GiftWrapError(
      `Expected seal kind 13, got ${event.kind}`,
      "INVALID_SEAL",
    );
  }

  if (!event.content || event.content.trim() === "") {
    throw new GiftWrapError("Seal content is empty", "INVALID_SEAL");
  }

  if (!event.pubkey) {
    throw new GiftWrapError("Seal missing pubkey", "INVALID_SEAL");
  }
}

/**
 * Validates that an event is a valid rumor (unsigned event)
 */
function validateRumor(event: any): NostrEvent {
  if (!event || typeof event !== "object") {
    throw new GiftWrapError("Rumor is not an object", "INVALID_RUMOR");
  }

  if (typeof event.kind !== "number") {
    throw new GiftWrapError("Rumor missing kind", "INVALID_RUMOR");
  }

  if (typeof event.content !== "string") {
    throw new GiftWrapError("Rumor missing content", "INVALID_RUMOR");
  }

  if (!Array.isArray(event.tags)) {
    throw new GiftWrapError("Rumor missing tags array", "INVALID_RUMOR");
  }

  if (typeof event.created_at !== "number") {
    throw new GiftWrapError("Rumor missing created_at", "INVALID_RUMOR");
  }

  // Rumor should NOT have id or sig (it's unsigned)
  // But it SHOULD have pubkey from the seal
  if (!event.pubkey) {
    throw new GiftWrapError("Rumor missing pubkey", "INVALID_RUMOR");
  }

  return event as NostrEvent;
}

/**
 * Unwraps a gift wrap to extract the seal
 *
 * @param giftWrap - Kind 1059 gift wrap event
 * @param signer - Signer for recipient (to decrypt)
 * @returns The seal event (kind 13)
 */
async function unwrapGiftWrap(
  giftWrap: NostrEvent,
  signer: Signer,
): Promise<NostrEvent> {
  validateGiftWrap(giftWrap);

  if (!signer.nip44Decrypt) {
    throw new GiftWrapError(
      "Signer does not support NIP-44 decryption",
      "NO_SIGNER",
    );
  }

  try {
    // Decrypt using the gift wrap author's pubkey (ephemeral key)
    const decryptedContent = await signer.nip44Decrypt(
      giftWrap.pubkey,
      giftWrap.content,
    );

    // Parse the seal event
    const seal = JSON.parse(decryptedContent);
    validateSeal(seal);

    return seal;
  } catch (error) {
    if (error instanceof GiftWrapError) {
      throw error;
    }

    throw new GiftWrapError(
      `Failed to decrypt gift wrap: ${error instanceof Error ? error.message : String(error)}`,
      "DECRYPTION_FAILED",
    );
  }
}

/**
 * Unseals a seal to extract the rumor
 *
 * @param seal - Kind 13 seal event
 * @param signer - Signer for recipient (to decrypt)
 * @returns The rumor (unsigned event) with sender's pubkey attached
 */
async function unsealSeal(
  seal: NostrEvent,
  signer: Signer,
): Promise<NostrEvent> {
  validateSeal(seal);

  if (!signer.nip44Decrypt) {
    throw new GiftWrapError(
      "Signer does not support NIP-44 decryption",
      "NO_SIGNER",
    );
  }

  try {
    // Decrypt using the seal author's pubkey (sender's real key)
    const decryptedContent = await signer.nip44Decrypt(
      seal.pubkey,
      seal.content,
    );

    // Parse the rumor
    const rumor = JSON.parse(decryptedContent);

    // Attach sender's pubkey to rumor (from seal)
    rumor.pubkey = seal.pubkey;

    const validatedRumor = validateRumor(rumor);
    return validatedRumor;
  } catch (error) {
    if (error instanceof GiftWrapError) {
      throw error;
    }

    throw new GiftWrapError(
      `Failed to unseal seal: ${error instanceof Error ? error.message : String(error)}`,
      "DECRYPTION_FAILED",
    );
  }
}

/**
 * Unwraps a gift wrap and unseals to extract the rumor (full process)
 *
 * @param giftWrap - Kind 1059 gift wrap event
 * @param recipientPubkey - The recipient's public key
 * @param signer - Signer for recipient (to decrypt)
 * @returns Object with seal and rumor
 */
export async function unwrapAndUnseal(
  giftWrap: NostrEvent,
  recipientPubkey: string,
  signer: Signer,
): Promise<{ seal: NostrEvent; rumor: NostrEvent }> {
  // Step 1: Unwrap gift wrap to get seal
  const seal = await unwrapGiftWrap(giftWrap, signer);

  // Step 2: Unseal to get rumor
  const rumor = await unsealSeal(seal, signer);

  return { seal, rumor };
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
  signer: Signer,
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
    const { seal, rumor } = await unwrapAndUnseal(
      giftWrap,
      recipientPubkey,
      signer,
    );

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

    // Update envelope and store rumor in transaction
    await db.transaction("rw", [db.giftWraps, db.decryptedRumors], async () => {
      envelope.status = "decrypted";
      await db.giftWraps.put(envelope);
      await db.decryptedRumors.put(decryptedRumor);
    });

    // Update conversation metadata
    await updateConversationMetadata(decryptedRumor);

    return decryptedRumor;
  } catch (error) {
    // Store failure
    envelope.status = "failed";
    envelope.failureReason =
      error instanceof Error ? error.message : String(error);
    await db.giftWraps.put(envelope);

    console.error(`[GiftWrap] Failed to process ${giftWrap.id}:`, error);
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
