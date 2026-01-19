/**
 * Shared message utilities for chat adapters
 *
 * Provides reusable functions for converting Nostr events
 * to chat Message objects.
 */

import type { NostrEvent } from "@/types/nostr";
import type { Message, ChatProtocol } from "@/types/chat";
import {
  getZapAmount,
  getZapSender,
  getZapRecipient,
  getZapRequest,
} from "applesauce-common/helpers/zap";

export interface ZapToMessageOptions {
  /** The conversation ID for the message */
  conversationId: string;
  /** The protocol to set on the message */
  protocol: ChatProtocol;
}

/**
 * Convert a zap receipt (kind 9735) to a Message
 *
 * Extracts zap metadata using applesauce helpers and builds
 * a Message object with type "zap".
 *
 * @param zapReceipt - The kind 9735 zap receipt event
 * @param options - Options including conversationId and protocol
 * @returns A Message object with type "zap"
 */
export function zapReceiptToMessage(
  zapReceipt: NostrEvent,
  options: ZapToMessageOptions,
): Message {
  const { conversationId, protocol } = options;

  // Extract zap metadata using applesauce helpers
  const amount = getZapAmount(zapReceipt);
  const sender = getZapSender(zapReceipt);
  const recipient = getZapRecipient(zapReceipt);
  const zapRequest = getZapRequest(zapReceipt);

  // Convert from msats to sats
  const amountInSats = amount ? Math.floor(amount / 1000) : 0;

  // Get zap comment from request content
  const comment = zapRequest?.content || "";

  // Find the event being zapped (e-tag)
  const eTag = zapReceipt.tags.find((t) => t[0] === "e");
  const replyTo = eTag?.[1];

  return {
    id: zapReceipt.id,
    conversationId,
    author: sender || zapReceipt.pubkey,
    content: comment,
    timestamp: zapReceipt.created_at,
    type: "zap",
    replyTo,
    protocol,
    metadata: {
      encrypted: false,
      zapAmount: amountInSats,
      zapRecipient: recipient,
    },
    event: zapReceipt,
  };
}

export interface NutzapToMessageOptions extends ZapToMessageOptions {}

/**
 * Convert a nutzap event (kind 9321) to a Message
 *
 * NIP-61 nutzaps are P2PK-locked Cashu token transfers.
 * Extracts proof amounts and builds a Message with type "zap".
 *
 * @param nutzapEvent - The kind 9321 nutzap event
 * @param options - Options including conversationId and protocol
 * @returns A Message object with type "zap"
 */
export function nutzapToMessage(
  nutzapEvent: NostrEvent,
  options: NutzapToMessageOptions,
): Message {
  const { conversationId, protocol } = options;

  // Sender is the event author
  const sender = nutzapEvent.pubkey;

  // Recipient is the p-tag value
  const pTag = nutzapEvent.tags.find((t) => t[0] === "p");
  const recipient = pTag?.[1] || "";

  // Reply target is the e-tag (the event being nutzapped)
  const eTag = nutzapEvent.tags.find((t) => t[0] === "e");
  const replyTo = eTag?.[1];

  // Amount is sum of proof amounts from all proof tags
  // NIP-61 allows multiple proof tags, each containing JSON-encoded Cashu proofs
  let amount = 0;
  for (const tag of nutzapEvent.tags) {
    if (tag[0] === "proof" && tag[1]) {
      try {
        const proof = JSON.parse(tag[1]);
        // Proof can be a single object or an array of proofs
        if (Array.isArray(proof)) {
          amount += proof.reduce(
            (sum: number, p: { amount?: number }) => sum + (p.amount || 0),
            0,
          );
        } else if (typeof proof === "object" && proof.amount) {
          amount += proof.amount;
        }
      } catch {
        // Invalid proof JSON, skip this tag
      }
    }
  }

  // Unit defaults to "sat" per NIP-61
  const unitTag = nutzapEvent.tags.find((t) => t[0] === "unit");
  const unit = unitTag?.[1] || "sat";

  // Comment is in the content field
  const comment = nutzapEvent.content || "";

  return {
    id: nutzapEvent.id,
    conversationId,
    author: sender,
    content: comment,
    timestamp: nutzapEvent.created_at,
    type: "zap",
    replyTo,
    protocol,
    metadata: {
      encrypted: false,
      zapAmount: amount,
      zapRecipient: recipient,
      nutzapUnit: unit,
    },
    event: nutzapEvent,
  };
}

export interface EventToMessageOptions {
  /** The conversation ID for the message */
  conversationId: string;
  /** The protocol to set on the message */
  protocol: ChatProtocol;
  /** Function to extract replyTo from the event */
  getReplyTo?: (event: NostrEvent) => string | undefined;
  /** Message type (defaults to "user") */
  type?: "user" | "system";
}

/**
 * Convert a generic event to a Message
 *
 * This is a base conversion that works for most chat message types.
 * Adapters can customize the replyTo extraction via options.
 *
 * @param event - The Nostr event to convert
 * @param options - Options including conversationId, protocol, and replyTo extractor
 * @returns A Message object
 */
export function eventToMessage(
  event: NostrEvent,
  options: EventToMessageOptions,
): Message {
  const { conversationId, protocol, getReplyTo, type = "user" } = options;

  const replyTo = getReplyTo ? getReplyTo(event) : undefined;

  return {
    id: event.id,
    conversationId,
    author: event.pubkey,
    content: event.content,
    timestamp: event.created_at,
    type,
    replyTo,
    protocol,
    metadata: {
      encrypted: false,
    },
    event,
  };
}

/**
 * Extract reply-to event ID from NIP-10 style e-tags
 *
 * Looks for "reply" marker first, then falls back to root.
 * Works for kind 1 (notes) and kind 1311 (live chat).
 *
 * @param event - The event to extract reply-to from
 * @param rootEventId - Optional root event ID (for fallback)
 * @returns The reply-to event ID or undefined
 */
export function getNip10ReplyTo(
  event: NostrEvent,
  rootEventId?: string,
): string | undefined {
  const eTags = event.tags.filter((t) => t[0] === "e");

  // Find explicit reply marker
  const replyTag = eTags.find((t) => t[3] === "reply");
  if (replyTag) return replyTag[1];

  // Find explicit root marker (if no reply, it's a direct reply to root)
  const rootTag = eTags.find((t) => t[3] === "root");
  if (rootTag) return rootTag[1];

  // Legacy: single e-tag means reply to that event
  if (eTags.length === 1 && !eTags[0][3]) {
    return eTags[0][1];
  }

  // Fallback to provided root
  return rootEventId;
}

/**
 * Extract reply-to event ID from NIP-22 style e-tags (comments)
 *
 * NIP-22 uses lowercase e tag for parent reference.
 *
 * @param event - The kind 1111 comment event
 * @returns The reply-to event ID or undefined
 */
export function getNip22ReplyTo(event: NostrEvent): string | undefined {
  // Lowercase e tag is the parent comment reference
  const parentTag = event.tags.find((t) => t[0] === "e");
  return parentTag?.[1];
}

/**
 * Extract reply-to event ID from q-tag (NIP-29 style)
 *
 * NIP-29 groups use q-tag for quote/reply references.
 *
 * @param event - The event to extract reply-to from
 * @returns The reply-to event ID or undefined
 */
export function getQTagReplyTo(event: NostrEvent): string | undefined {
  const qTag = event.tags.find((t) => t[0] === "q");
  return qTag?.[1];
}
