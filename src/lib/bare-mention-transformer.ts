/**
 * NIP-19 references glued to the text around them.
 *
 * applesauce's `nostrMentions` requires the id to start a line or follow
 * whitespace — a lookbehind that exists to keep it out of URLs, since
 * `habla.news/a/naddr1…` must stay one link rather than become a link plus a
 * mention. The cost is that anything written mid-word goes unresolved, and
 * people write them mid-word constantly: "…want to see it.nevent1qqs…" renders
 * as 200 characters of bech32 in the middle of a sentence.
 *
 * Armada (`bc19d1f`, `src/components/chat/ChatContent.tsx`) has no boundary
 * rule at all — its tokenizer alternation is `URL | nostr:id | @?bare id`, and
 * ORDER is what keeps ids inside URLs from matching: the URL is consumed first,
 * so nothing is left for the bare branch to find. This transformer takes the
 * same position, running after `links` and `nostrMentions` have taken theirs.
 *
 * Deliberately NOT ported from armada: unwrapping a NIP-19 id out of a URL PATH
 * into an embed. Armada does that for `naddr1` only (habla-style article links)
 * and leaves `nevent1` in a URL as a plain link, which is what grimoire already
 * renders.
 */

import { findAndReplace } from "applesauce-content/nast";
import type { Root } from "applesauce-content/nast";
import { decodePointer } from "applesauce-core/helpers/pointers";

/**
 * A NIP-19 id with no boundary requirement, optionally `@`-prefixed.
 *
 * The 58-character minimum is applesauce's, and it is what makes matching
 * inside a word safe: no ordinary text carries 58 consecutive bech32 characters
 * after an `npub1`-style prefix, and anything that somehow does still has to
 * decode.
 */
const BARE_NIP19 =
  /@?((npub|note|nprofile|nevent|naddr)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58,})/gi;

/** Resolve NIP-19 ids that `nostrMentions` skipped for want of a boundary. */
export function bareNostrMentions() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        BARE_NIP19,
        (_: string, $1: string) => {
          try {
            return { type: "mention", decoded: decodePointer($1), encoded: $1 };
          } catch {
            // Not a real id — leave the text alone.
          }
          return false;
        },
      ],
    ]);
  };
}
