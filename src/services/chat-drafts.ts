/**
 * Half-typed messages, kept per channel.
 *
 * One tiptap instance serves every conversation a chat window shows, so
 * switching channels used to carry the text with it — into the wrong channel,
 * where it was either sent to the wrong people or lost the moment the window
 * closed. The composer's content is therefore saved against the conversation it
 * was typed in, and restored when the reader comes back to it.
 *
 * **Keyed by ACCOUNT first.** Armada's draft key is the relay and group with no
 * account component, which is safe for a single-identity client and not for
 * this one: grimoire switches accounts in place, and a key without the account
 * would show one identity the message another was drafting. It is also the only
 * column this table has to wipe by, which is why the account leads the key —
 * `clearCommunities` deletes on that prefix at logout, because a draft is
 * plaintext the sender has not even decided to send yet.
 *
 * Dexie rather than localStorage, and a synchronous cache in front of it,
 * exactly like the wire's relay cursors: the composer needs an answer during a
 * render, and the store answers in a promise. The cold-start gate is
 * {@link draftsReady} — reading before it resolves would report "no draft" and
 * a restore that then wrote back would delete the real one.
 */

import db, { type ChatDraftRow } from "@/services/db";

/**
 * `${account}:${protocol}:${conversation}` — account first, deliberately.
 *
 * Already protocol-qualified, and the template the rest of the chat keys were
 * brought up to: a conversation id is only unique within a protocol, and this
 * table is the one place two protocols already write side by side.
 *
 * Two things a reader should know before touching the shape. The key is built
 * here and taken apart NOWHERE — `clearCommunities` matches the account prefix
 * and nothing else parses it — which is what makes the separator survivable at
 * all, since a NIP-29 conversation id is `nip-29:${relayUrl}'${groupId}` and a
 * relay URL is full of colons and slashes. That same id already carries its
 * protocol, so a NIP-29 draft key spells `…:nip-29:nip-29:wss://…` — redundant,
 * harmless while nothing splits the key, and left alone here: changing it would
 * orphan the drafts already stored under it for no behaviour the reader can
 * see.
 */
export function draftKey(
  accountPubkey: string,
  protocol: string,
  conversationId: string,
): string {
  return `${accountPubkey}:${protocol}:${conversationId}`;
}

const cache = new Map<string, ChatDraftRow>();
let warm: Promise<void> | undefined;

/** Resolve once the cache holds what the table holds. Idempotent. */
export function draftsReady(): Promise<void> {
  warm ??= db.chatDrafts
    .toArray()
    .then((rows) => {
      for (const row of rows) cache.set(row.key, row);
    })
    .catch((error: unknown) => {
      console.warn("[chat] could not load drafts:", error);
    });
  return warm;
}

/** The draft for one conversation, synchronously. Warm the cache first. */
export function readDraft(key: string): ChatDraftRow | undefined {
  return cache.get(key);
}

/** Save what is in the composer. Write-through; the cache answers reads. */
export function writeDraft(
  key: string,
  content: unknown,
  replyToId?: string,
): void {
  const row: ChatDraftRow = {
    key,
    content,
    updatedAt: Date.now(),
    ...(replyToId ? { replyToId } : {}),
  };
  cache.set(key, row);
  void db.chatDrafts.put(row).catch((error: unknown) => {
    console.warn("[chat] could not save the draft:", error);
  });
}

/** Forget one conversation's draft — it was sent, or emptied. */
export function clearDraft(key: string): void {
  cache.delete(key);
  void db.chatDrafts.delete(key).catch(() => undefined);
}

/**
 * Whether a stored draft may be dropped into the composer.
 *
 * The empty-editor rule is the whole safety of the restore: a draft arriving
 * after the reader has already started typing must never overwrite them, and on
 * a fast channel switch the read and the typing genuinely do race.
 */
export function shouldRestoreDraft(
  draft: ChatDraftRow | undefined,
  editorIsEmpty: boolean,
): boolean {
  return !!draft && draft.content !== undefined && editorIsEmpty;
}

/**
 * Drop every cached draft — the logout wipe's in-memory half.
 *
 * The rows go with `clearCommunities`; without this the tab keeps serving them
 * from memory to whoever signs in next.
 */
export function resetDraftCache(): void {
  cache.clear();
  warm = undefined;
}
