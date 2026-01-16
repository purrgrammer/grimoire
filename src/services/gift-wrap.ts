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
 * Creates a plain serializable copy of an event object
 * Strips Symbols and non-enumerable properties added by applesauce
 *
 * CRITICAL: Applesauce attaches Symbol properties to event objects for caching.
 * These Symbols cannot be serialized by Dexie (IndexedDB). Always use this function
 * before storing events in the database.
 */
export function serializableEvent(event: any): NostrEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig || "", // Rumors don't have sig, use empty string
  };
}

/**
 * Unwraps a gift wrap and unseals to extract the rumor (full process)
 * Uses applesauce-common unlockGiftWrap helper
 *
 * Note: Rumors are unsigned events (no sig field) - this is by design in NIP-59.
 * Applesauce caches the rumor on the gift wrap event object using symbols.
 *
 * @param giftWrap - Kind 1059 gift wrap event
 * @param signer - Signer for recipient (to decrypt)
 * @returns Object with seal and rumor
 */
export async function unwrapAndUnseal(
  giftWrap: NostrEvent,
  signer: ISigner,
): Promise<{ seal: NostrEvent; rumor: NostrEvent }> {
  // Validate gift wrap structure before processing
  if (giftWrap.kind !== 1059) {
    throw new GiftWrapError(
      `Expected kind 1059, got ${giftWrap.kind}`,
      "INVALID_KIND",
    );
  }

  if (!giftWrap.content || giftWrap.content.trim() === "") {
    throw new GiftWrapError("Gift wrap content is empty", "MISSING_CONTENT");
  }

  // CRITICAL: Validate signer has NIP-44 support
  // NIP-59 gift wraps REQUIRE NIP-44 encryption
  if (!signer.nip44) {
    throw new GiftWrapError(
      "Signer does not support NIP-44 encryption (required for NIP-59 gift wraps). " +
        "Please use a browser extension that supports NIP-44 (e.g., Alby, nos2x-fox, Nostr-Connect).",
      "NO_SIGNER",
    );
  }

  // CRITICAL: Add to event store before unlocking
  // Applesauce requires the event to be in the store for caching to work
  // We wrap in try-catch because the event might not be valid for the event store
  // (e.g., in tests), but we can still attempt decryption
  try {
    eventStore.add(giftWrap);
  } catch (error) {
    // If adding to event store fails, log but continue
    // Decryption might still work, but caching will be less efficient
    console.warn(
      `[GiftWrap] Failed to add gift wrap to event store: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
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

    // Validate seal
    if (seal.kind !== 13) {
      throw new GiftWrapError(
        `Expected seal kind 13, got ${seal.kind}`,
        "INVALID_SEAL",
      );
    }

    if (!seal.content || seal.content.trim() === "") {
      throw new GiftWrapError("Seal content is empty", "MISSING_CONTENT");
    }

    // Validate rumor
    if (!rumor.content || typeof rumor.content !== "string") {
      throw new GiftWrapError("Rumor missing content", "INVALID_RUMOR");
    }

    // Convert rumor to NostrEvent (rumor has id but no sig)
    const rumorEvent = rumor as NostrEvent;

    return { seal, rumor: rumorEvent };
  } catch (error) {
    // Re-throw GiftWrapError as-is
    if (error instanceof GiftWrapError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages for common issues
    if (message.includes("Unexpected token") || message.includes("JSON")) {
      throw new GiftWrapError(
        `Decrypted content is not valid JSON. This gift wrap may be malformed or use incompatible encryption. ` +
          `Event ID: ${giftWrap.id.slice(0, 16)}... (${message})`,
        "INVALID_SEAL",
      );
    }

    if (
      message.includes("can't serialize") ||
      message.includes("wrong or missing properties")
    ) {
      throw new GiftWrapError(
        `Decrypted seal is missing required event properties. This gift wrap may be malformed. ` +
          `Event ID: ${giftWrap.id.slice(0, 16)}... (${message})`,
        "INVALID_SEAL",
      );
    }

    if (message.includes("Seal author does not match rumor author")) {
      throw new GiftWrapError(
        `Seal and rumor authors don't match - possible tampering. ` +
          `Event ID: ${giftWrap.id.slice(0, 16)}...`,
        "INVALID_SEAL",
      );
    }

    // Map decryption errors
    if (
      message.includes("decrypt") ||
      message.includes("Mock decryption failed")
    ) {
      throw new GiftWrapError(
        `Failed to decrypt: ${message}`,
        "DECRYPTION_FAILED",
      );
    }

    // Default to generic decryption failed
    throw new GiftWrapError(
      `Failed to unlock gift wrap: ${message}`,
      "DECRYPTION_FAILED",
    );
  }
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

  // Store gift wrap envelope (use plain object to avoid Symbol serialization issues)
  const envelope: GiftWrapEnvelope = {
    id: giftWrap.id,
    recipientPubkey,
    event: serializableEvent(giftWrap),
    status: "pending",
    receivedAt: existing?.receivedAt || Date.now(),
    processedAt: Date.now(),
  };

  try {
    // Unwrap and unseal (this adds to event store internally)
    const { seal, rumor } = await unwrapAndUnseal(giftWrap, signer);

    // Store decrypted rumor (use plain objects to avoid Symbol serialization issues)
    const decryptedRumor: DecryptedRumor = {
      giftWrapId: giftWrap.id,
      recipientPubkey,
      senderPubkey: seal.pubkey,
      seal: serializableEvent(seal),
      rumor: serializableEvent(rumor),
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
