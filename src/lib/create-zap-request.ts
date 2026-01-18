/**
 * Create NIP-57 zap request (kind 9734)
 */

import { EventFactory } from "applesauce-core/event-factory";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer, AddressPointer } from "./open-parser";
import accountManager from "@/services/accounts";
import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

export interface EmojiTag {
  shortcode: string;
  url: string;
}

export interface ZapRequestParams {
  /** Recipient pubkey (who receives the zap) */
  recipientPubkey: string;
  /** Amount in millisatoshis */
  amountMillisats: number;
  /** Optional comment/message */
  comment?: string;
  /** Optional event being zapped */
  eventPointer?: EventPointer | AddressPointer;
  /** Relays where zap receipt should be published */
  relays?: string[];
  /** LNURL for the recipient */
  lnurl?: string;
  /** NIP-30 custom emoji tags */
  emojiTags?: EmojiTag[];
}

/**
 * Create and sign a zap request event (kind 9734)
 * This event is NOT published to relays - it's sent to the LNURL callback
 */
export async function createZapRequest(
  params: ZapRequestParams,
): Promise<NostrEvent> {
  const account = accountManager.active;

  if (!account) {
    throw new Error("No active account. Please log in to send zaps.");
  }

  const signer = account.signer;
  if (!signer) {
    throw new Error("No signer available for active account");
  }

  // Get relays for zap receipt publication
  let relays = params.relays;
  if (!relays || relays.length === 0) {
    // Use sender's read relays (where they want to receive zap receipts)
    const senderReadRelays =
      (await relayListCache.getInboxRelays(account.pubkey)) || [];
    relays = senderReadRelays.length > 0 ? senderReadRelays : AGGREGATOR_RELAYS;
  }

  // Build tags
  const tags: string[][] = [
    ["p", params.recipientPubkey],
    ["amount", params.amountMillisats.toString()],
    ["relays", ...relays.slice(0, 10)], // Limit to 10 relays
  ];

  // Add lnurl tag if provided
  if (params.lnurl) {
    tags.push(["lnurl", params.lnurl]);
  }

  // Add event reference if zapping an event
  if (params.eventPointer) {
    if ("id" in params.eventPointer) {
      // Regular event (e tag)
      tags.push(["e", params.eventPointer.id]);
      // Include author if available
      if (params.eventPointer.author) {
        tags.push(["p", params.eventPointer.author]);
      }
      // Include relay hints
      if (params.eventPointer.relays && params.eventPointer.relays.length > 0) {
        tags.push(["e", params.eventPointer.id, params.eventPointer.relays[0]]);
      }
    } else {
      // Addressable event (a tag)
      const coordinate = `${params.eventPointer.kind}:${params.eventPointer.pubkey}:${params.eventPointer.identifier}`;
      tags.push(["a", coordinate]);
      // Include relay hint if available
      if (params.eventPointer.relays && params.eventPointer.relays.length > 0) {
        tags.push(["a", coordinate, params.eventPointer.relays[0]]);
      }
    }
  }

  // Add NIP-30 emoji tags
  if (params.emojiTags) {
    for (const emoji of params.emojiTags) {
      tags.push(["emoji", emoji.shortcode, emoji.url]);
    }
  }

  // Create event template
  const template = {
    kind: 9734,
    content: params.comment || "",
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };

  // Sign the event
  const factory = new EventFactory({ signer });
  const draft = await factory.build(template);
  const signedEvent = await factory.sign(draft);

  return signedEvent as NostrEvent;
}

/**
 * Serialize zap request event to URL-encoded JSON for LNURL callback
 */
export function serializeZapRequest(event: NostrEvent): string {
  return encodeURIComponent(JSON.stringify(event));
}
