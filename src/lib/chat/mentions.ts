/**
 * Who a chat message is addressed to.
 *
 * ONE predicate, deliberately: the unread badge, the NEW divider's mention
 * flag, the timeline row highlight and notification policy all have to answer
 * "was I mentioned" the same way, and parallel `p`-tag scans would drift the
 * first time one of them learned about a new tag shape.
 *
 * PROTOCOL-NEUTRAL, and living outside `lib/concord/` for that reason: both
 * functions take tags or plain content and know nothing about a rumor, a
 * community or an epoch. A mention is a `["p", <pubkey>]` tag — the tag NIP-01
 * uses everywhere, the one a NIP-29 group message carries, and the one armada
 * matches on — so the same predicate serves every protocol grimoire renders.
 *
 * Note what that inherits: `buildConcordCommentTags` p-tags the parent of every
 * threaded reply (`send.ts`), so a reply TO you reads as a mention of you even
 * with no @ in the body. Armada behaves identically — a reply is directed at
 * you — so it is a stated rule here rather than an accident to fix.
 *
 * Both directions live here on purpose: {@link extractMentionTags} writes the
 * tag and {@link mentionsPubkey} reads it, and a client that wrote one shape
 * while reading another would be mention-blind to its own messages.
 */

import { nip19 } from "nostr-tools";

/**
 * The `p` tags an outgoing message owes the people it names.
 *
 * The WRITE side of the same rule {@link mentionsPubkey} reads. A mention is
 * recovered from the rendered content — `nostr:npub1…` / `nostr:nprofile1…`,
 * which is what the composer serializes — rather than from an editor-side list,
 * because that is where armada extracts it too, and matching it is the whole
 * point: a grimoire @-mention has to badge and notify an armada reader.
 *
 * The tag rides the NIP-44-sealed rumor, never the kind-1059 wrap, so it names
 * a member to the channel and nothing to the relay. The corollary is that no
 * relay filter can find it — a mention is only ever detectable from the local
 * decrypted store.
 *
 * `exclude` is what keeps the tag list honest: the sender (mentioning yourself
 * is not a notification) and, for a reply, the parent's author — whom
 * `buildConcordCommentTags` already p-tags, so including them again would
 * double the tag and say nothing new.
 */
export function extractMentionTags(
  content: string,
  exclude: Iterable<string> = [],
): string[][] {
  const skip = new Set<string>();
  for (const pubkey of exclude) if (pubkey) skip.add(pubkey.toLowerCase());

  const found = new Set<string>();
  // Bech32's charset, minus `1bio` — the separator and the excluded letters.
  const matches = content.matchAll(
    /nostr:(npub1|nprofile1)([023456789acdefghjklmnpqrstuvwxyz]+)/g,
  );
  for (const match of matches) {
    try {
      const decoded = nip19.decode(`${match[1]}${match[2]}`);
      if (decoded.type === "npub") found.add(decoded.data.toLowerCase());
      else if (decoded.type === "nprofile")
        found.add(decoded.data.pubkey.toLowerCase());
    } catch {
      // Not a real bech32 payload — someone typed something that looked like
      // one. A send must not fail over it.
    }
  }

  const tags: string[][] = [];
  for (const pubkey of found) if (!skip.has(pubkey)) tags.push(["p", pubkey]);
  return tags;
}

/** Whether these tags address `pubkey` — a `["p", pubkey]` tag. */
export function mentionsPubkey(
  tags: readonly string[][],
  pubkey: string,
): boolean {
  if (!pubkey) return false;
  const wanted = pubkey.toLowerCase();
  for (const tag of tags) {
    if (tag[0] === "p" && tag[1]?.toLowerCase() === wanted) return true;
  }
  return false;
}
