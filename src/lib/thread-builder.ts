import type { NostrEvent } from "nostr-tools/core";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { getNip10References } from "applesauce-common/helpers/threading";

/**
 * Thread tags for an event reply
 */
export interface ThreadTags {
  /** Tag array to include in the event */
  tags: string[][];
  /** Relay hint for the reply */
  relayHint?: string;
}

/**
 * Build thread tags for a Kind 1 note (NIP-10)
 *
 * NIP-10 structure:
 * - ["e", <root-id>, <relay-url>, "root"]
 * - ["e", <reply-id>, <relay-url>, "reply"]
 * - ["p", <pubkey>] for each mentioned pubkey
 *
 * @param replyTo - Event being replied to
 * @param additionalMentions - Additional pubkeys to mention
 */
export function buildNip10Tags(
  replyTo: NostrEvent,
  additionalMentions: string[] = [],
): ThreadTags {
  const tags: string[][] = [];
  const references = getNip10References(replyTo);

  // Add root tag
  if (references.root) {
    const root = references.root.e || references.root.a;
    if (root && "id" in root) {
      // EventPointer
      const relay = root.relays?.[0];
      tags.push(
        relay ? ["e", root.id, relay, "root"] : ["e", root.id, "", "root"],
      );
    }
  } else {
    // This is the root - mark it as such
    const relay = replyTo.relay;
    tags.push(
      relay ? ["e", replyTo.id, relay, "root"] : ["e", replyTo.id, "", "root"],
    );
  }

  // Add reply tag (always the event we're directly replying to)
  const relay = replyTo.relay;
  tags.push(
    relay ? ["e", replyTo.id, relay, "reply"] : ["e", replyTo.id, "", "reply"],
  );

  // Collect all mentioned pubkeys
  const mentionedPubkeys = new Set<string>();

  // Add author of reply-to event
  mentionedPubkeys.add(replyTo.pubkey);

  // Add authors from thread history
  if (references.mentions) {
    for (const mention of references.mentions) {
      const pointer = mention.e || mention.a;
      if (pointer && "pubkey" in pointer && pointer.pubkey) {
        mentionedPubkeys.add(pointer.pubkey);
      }
    }
  }

  // Add additional mentions
  for (const pubkey of additionalMentions) {
    mentionedPubkeys.add(pubkey);
  }

  // Add p tags (mentions)
  for (const pubkey of mentionedPubkeys) {
    tags.push(["p", pubkey]);
  }

  return {
    tags,
    relayHint: relay,
  };
}

/**
 * Build thread tags for NIP-22 comments (all kinds except 1)
 *
 * NIP-22 structure for replies:
 * - ["K", <kind>] - kind of event being commented on
 * - ["E", <event-id>, <relay-url>, <pubkey>] - event pointer
 * - OR ["A", <kind:pubkey:d-tag>, <relay-url>] - address pointer
 * - ["p", <pubkey>] for each mentioned pubkey
 * - ["k", <parent-kind>] - deprecated but included for compatibility
 *
 * @param replyTo - Event being commented on
 * @param additionalMentions - Additional pubkeys to mention
 */
export function buildNip22Tags(
  replyTo: NostrEvent,
  additionalMentions: string[] = [],
): ThreadTags {
  const tags: string[][] = [];

  // Add K tag (kind of parent event)
  tags.push(["K", String(replyTo.kind)]);

  // Check if this is a replaceable event (30000-39999)
  const isReplaceable = replyTo.kind >= 30000 && replyTo.kind < 40000;
  const isParameterized = replyTo.kind >= 30000 && replyTo.kind < 40000;

  if (isParameterized) {
    // Use A tag for parameterized replaceable events
    const dTag = replyTo.tags.find((t) => t[0] === "d")?.[1] || "";
    const coordinate = `${replyTo.kind}:${replyTo.pubkey}:${dTag}`;
    const relay = replyTo.relay;
    tags.push(relay ? ["A", coordinate, relay] : ["A", coordinate]);
  } else {
    // Use E tag for regular and replaceable events
    const relay = replyTo.relay;
    tags.push(
      relay
        ? ["E", replyTo.id, relay, replyTo.pubkey]
        : ["E", replyTo.id, "", replyTo.pubkey],
    );
  }

  // Add deprecated k tag for compatibility
  tags.push(["k", String(replyTo.kind)]);

  // Collect mentioned pubkeys
  const mentionedPubkeys = new Set<string>();
  mentionedPubkeys.add(replyTo.pubkey);

  // Add additional mentions
  for (const pubkey of additionalMentions) {
    mentionedPubkeys.add(pubkey);
  }

  // Add p tags
  for (const pubkey of mentionedPubkeys) {
    tags.push(["p", pubkey]);
  }

  return {
    tags,
    relayHint: replyTo.relay,
  };
}

/**
 * Build thread tags for any event kind
 * Automatically chooses between NIP-10 and NIP-22 based on kind
 *
 * @param replyTo - Event being replied to
 * @param replyKind - Kind of the reply event (defaults to 1 for notes)
 * @param additionalMentions - Additional pubkeys to mention
 */
export function buildThreadTags(
  replyTo: NostrEvent,
  replyKind: number = 1,
  additionalMentions: string[] = [],
): ThreadTags {
  // Kind 1 uses NIP-10
  if (replyKind === 1) {
    return buildNip10Tags(replyTo, additionalMentions);
  }

  // Everything else uses NIP-22
  return buildNip22Tags(replyTo, additionalMentions);
}

/**
 * Extract pubkeys from nostr: mentions in content
 *
 * @param content - Message content with nostr:npub... mentions
 * @returns Array of pubkeys mentioned in content
 */
export function extractMentionsFromContent(content: string): string[] {
  const mentionRegex = /nostr:npub1[a-z0-9]{58}/g;
  const matches = content.match(mentionRegex) || [];

  const pubkeys = new Set<string>();

  for (const match of matches) {
    try {
      // Remove "nostr:" prefix and decode npub
      const npub = match.replace("nostr:", "");
      // We'll need to decode this - for now just extract the pattern
      // The MentionEditor already handles encoding, so we can extract from tags instead
    } catch {
      // Skip invalid npubs
    }
  }

  return Array.from(pubkeys);
}
