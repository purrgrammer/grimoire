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
  /** Optional event being zapped (adds e-tag) */
  eventPointer?: EventPointer;
  /** Optional addressable event context (adds a-tag, e.g., live activity) */
  addressPointer?: AddressPointer;
  /** Relays where zap receipt should be published */
  relays?: string[];
  /** LNURL for the recipient */
  lnurl?: string;
  /** NIP-30 custom emoji tags */
  emojiTags?: EmojiTag[];
  /**
   * Custom tags to include in the zap request (beyond standard p/amount/relays)
   * Used for additional protocol-specific tagging
   */
  customTags?: string[][];
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
  // Priority: explicit params.relays > semantic author relays > sender read relays > aggregators
  let relays: string[] | undefined = params.relays
    ? [...new Set(params.relays)] // Deduplicate explicit relays
    : undefined;

  if (!relays || relays.length === 0) {
    const collectedRelays: string[] = [];

    // Collect outbox relays from semantic authors (event author and/or addressable event pubkey)
    const authorsToQuery: string[] = [];
    if (params.eventPointer?.author) {
      authorsToQuery.push(params.eventPointer.author);
    }
    if (params.addressPointer?.pubkey) {
      authorsToQuery.push(params.addressPointer.pubkey);
    }

    // Deduplicate authors
    const uniqueAuthors = [...new Set(authorsToQuery)];

    // Fetch outbox relays for each author
    for (const authorPubkey of uniqueAuthors) {
      const authorOutboxes =
        (await relayListCache.getOutboxRelays(authorPubkey)) || [];
      collectedRelays.push(...authorOutboxes);
    }

    // Include relay hints from pointers
    if (params.eventPointer?.relays) {
      collectedRelays.push(...params.eventPointer.relays);
    }
    if (params.addressPointer?.relays) {
      collectedRelays.push(...params.addressPointer.relays);
    }

    // Deduplicate collected relays
    const uniqueRelays = [...new Set(collectedRelays)];

    if (uniqueRelays.length > 0) {
      relays = uniqueRelays;
    } else {
      // Fallback to sender's read relays (where they want to receive zap receipts)
      const senderReadRelays =
        (await relayListCache.getInboxRelays(account.pubkey)) || [];
      relays =
        senderReadRelays.length > 0 ? senderReadRelays : AGGREGATOR_RELAYS;
    }
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

  // Add event reference if zapping an event (e-tag)
  if (params.eventPointer) {
    const relayHint = params.eventPointer.relays?.[0] || "";
    if (relayHint) {
      tags.push(["e", params.eventPointer.id, relayHint]);
    } else {
      tags.push(["e", params.eventPointer.id]);
    }
  }

  // Add addressable event reference (a-tag) - for NIP-53 live activities, etc.
  if (params.addressPointer) {
    const coordinate = `${params.addressPointer.kind}:${params.addressPointer.pubkey}:${params.addressPointer.identifier}`;
    const relayHint = params.addressPointer.relays?.[0] || "";
    if (relayHint) {
      tags.push(["a", coordinate, relayHint]);
    } else {
      tags.push(["a", coordinate]);
    }
  }

  // Add custom tags (protocol-specific like NIP-53 live activity references)
  if (params.customTags) {
    for (const tag of params.customTags) {
      tags.push(tag);
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
 * Serialize zap request event to JSON string for LNURL callback
 * Note: Do NOT encodeURIComponent here - URLSearchParams.set() will handle encoding
 */
export function serializeZapRequest(event: NostrEvent): string {
  return JSON.stringify(event);
}
