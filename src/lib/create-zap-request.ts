/**
 * Create NIP-57 zap request (kind 9734)
 */

import { EventFactory } from "applesauce-core/event-factory";
import type { ISigner } from "applesauce-signers";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer, AddressPointer } from "./open-parser";
import accountManager from "@/services/accounts";
import { selectZapRelays } from "./zap-relay-selection";
import { settingsManager } from "@/services/settings";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

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
  /** Optional signer for anonymous zaps (overrides account signer) */
  signer?: ISigner;
}

/**
 * Create and sign a zap request event (kind 9734)
 * This event is NOT published to relays - it's sent to the LNURL callback
 *
 * @param params.signer - Optional signer for anonymous zaps. When provided,
 *                        uses this signer instead of the active account's signer.
 */
export async function createZapRequest(
  params: ZapRequestParams,
): Promise<NostrEvent> {
  // Use provided signer (for anonymous zaps) or fall back to account signer
  let signer = params.signer;
  let senderPubkey: string | undefined;

  if (signer) {
    // Anonymous zap - use provided signer
    senderPubkey = await signer.getPublicKey();
  } else {
    // Normal zap - use account signer
    const account = accountManager.active;

    if (!account) {
      throw new Error("No active account. Please log in to send zaps.");
    }

    signer = account.signer;
    if (!signer) {
      throw new Error("No signer available for active account");
    }
    senderPubkey = account.pubkey;
  }

  // Get relays for zap receipt publication
  // Priority: explicit relays > recipient's inbox > sender's inbox > fallback aggregators
  const zapRelayResult = await selectZapRelays({
    recipientPubkey: params.recipientPubkey,
    senderPubkey,
    explicitRelays: params.relays,
  });
  const relays = zapRelayResult.relays;

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

  // Add client tag if enabled in settings
  if (settingsManager.getSetting("includeClientTag")) {
    tags.push(GRIMOIRE_CLIENT_TAG);
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
