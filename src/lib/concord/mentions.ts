/**
 * Who a Concord rumor is addressed to.
 *
 * ONE predicate, deliberately: the unread badge, the NEW divider's mention
 * flag, the timeline row highlight and (later) notification policy all have to
 * answer "was I mentioned" the same way, and three parallel `p`-tag scans would
 * drift the first time one of them learned about a new tag shape.
 *
 * A mention is a `["p", <pubkey>]` tag, the same tag NIP-01 uses everywhere and
 * the same one armada matches on. Note what that inherits: `buildConcordCommentTags`
 * p-tags the parent of every threaded reply (`send.ts`), so a reply TO you reads
 * as a mention of you even with no @ in the body. Armada behaves identically —
 * a reply is directed at you — so it is a stated rule here rather than an
 * accident to fix.
 */

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
