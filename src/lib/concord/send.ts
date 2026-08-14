/**
 * Building an outgoing chat-plane wrap (CORD-03).
 *
 * Ported from armada `bc19d1f` (`src/concord/hooks/useChannel.ts`'s send
 * mutation and `src/concord/lib/chat.ts`'s tag helpers), with the React and the
 * optimistic-UI half left behind — this is the pure assembly, so the tag rules
 * that make a message readable by every other client are testable without a
 * signer or a socket.
 *
 * Three rules a sender cannot get wrong quietly:
 *
 * - **Every chat rumor commits its channel and epoch** (`channelBindingTags`).
 *   A reader checks that binding against the coordinate whose key opened the
 *   wrap, so a missing one is not "untagged", it is undecodable.
 * - **A threaded reply is a NIP-22 kind-1111 comment**, never a kind-9 with a
 *   `q` tag. NIP-C7 reserves `q` for inline quote-replies, and conflating the
 *   two renders wrong in every other client.
 * - **While a disappearing timer is set, the NIP-40 deadline goes on BOTH the
 *   rumor and the wrap** (CORD-08 §2). The rumor's copy is what readers
 *   enforce; the wrap's is what makes relays delete the ciphertext.
 */

import { chatExpiresAt } from "@/lib/concord/disappearing";
import {
  KIND_COMMENT,
  KIND_DELETE,
  KIND_MESSAGE,
  KIND_REACTION,
  KIND_SEAL_ENCRYPTED,
} from "@/lib/concord/kinds";
import {
  buildRumor,
  channelBindingTags,
  sealRumor,
  wrapSeal,
  type StreamSigner,
} from "@/lib/concord/stream";
import type { Channel } from "@/lib/concord/types";
import type { NostrEvent } from "nostr-tools";

/** The parent a threaded reply cites — all rumor-side facts, no relay hints. */
export interface ReplyParent {
  id: string;
  kind: number;
  pubkey: string;
  tags: string[][];
}

/**
 * The NIP-22 tags for a kind-1111 reply to `parent`.
 *
 * Uppercase `K`/`E`/`P` pin the immutable THREAD ROOT; lowercase `k`/`e`/`p`
 * point at the IMMEDIATE parent. When the parent is itself a comment its root
 * tags are inherited verbatim, so the root stays stable at any nesting depth
 * rather than drifting one level deeper per reply.
 *
 * Every id here is a RUMOR id — the hash of the inner unsigned event — so a
 * reply cites exactly the decrypted message the user replied to, and means
 * nothing outside the channel.
 */
export function buildConcordCommentTags(parent: ReplyParent): string[][] {
  const tags: string[][] = [];

  const rootTags = parent.tags.filter(
    ([name]) => name === "K" || name === "E" || name === "P",
  );
  if (rootTags.length > 0) {
    // The parent is itself a comment: inherit its root pointer verbatim.
    for (const tag of rootTags) tags.push([...tag]);
  } else {
    // The parent IS the root of this thread.
    tags.push(["K", String(parent.kind)]);
    tags.push(["E", parent.id, "", parent.pubkey]);
    tags.push(["P", parent.pubkey]);
  }

  tags.push(["k", String(parent.kind)]);
  tags.push(["e", parent.id, "", parent.pubkey]);
  tags.push(["p", parent.pubkey]);

  return tags;
}

export interface BuildChatSendOptions {
  channel: Channel;
  /** The sender's real pubkey — the seal carries their identity, not the stream's. */
  pubkey: string;
  content: string;
  /** 9 message (default), 7 reaction, 5 delete. 1111 is implied by `replyTo`. */
  kind?: number;
  /** Present ⇒ a NIP-22 kind-1111 comment rather than a kind-9. */
  replyTo?: ReplyParent;
  /** The `e`-target of a reaction or delete. */
  target?: string;
  /** The target's kind, for a delete's NIP-09 `k` tag. Defaults to a message. */
  targetKind?: number;
  /** The target's author, for a reaction's NIP-25 `p` tag. */
  targetPubkey?: string;
  /** Appended verbatim: NIP-30 emoji, NIP-92 imeta, … */
  extraTags?: string[][];
  /** The folded `message_expiration`, in seconds. 0 or absent = off. */
  timerSecs?: number;
  /** Send time in epoch MILLIseconds. Defaults to now. */
  ms?: number;
}

/** What a send produced, before it goes anywhere. */
export interface BuiltChatSend {
  /** The wrap to publish — the only part that reaches a relay. */
  wrap: NostrEvent;
  /** The rumor as the author signed it, for the local store. */
  rumor: { id: string; kind: number; content: string; tags: string[][] };
  /** The signed seal, kept so the stored row matches an ingested one. */
  seal: NostrEvent;
  /** Milliseconds, for the timeline's sub-second ordering. */
  ms: number;
  createdAt: number;
}

/**
 * Build one chat-plane send: rumor → seal → wrap.
 *
 * Exactly ONE signer round-trip, on the seal — which for a NIP-46 login is a
 * remote call that can take seconds. The wrap is signed locally by the stream
 * key, which the client holds.
 */
export async function buildChatSend(
  opts: BuildChatSendOptions,
  signer: StreamSigner,
): Promise<BuiltChatSend> {
  const { channel } = opts;
  // A reply is a comment, whatever kind the caller asked for.
  const kind = opts.replyTo ? KIND_COMMENT : (opts.kind ?? KIND_MESSAGE);
  const ms = opts.ms ?? Date.now();

  const tags: string[][] = [
    ...channelBindingTags(channel.idHex, channel.current.epoch),
  ];
  if (opts.replyTo) tags.push(...buildConcordCommentTags(opts.replyTo));
  if (opts.target) tags.push(["e", opts.target]);
  // NIP-25 asks a reaction to name the author it reacts to. Safe here because
  // the tag rides the NIP-44-encrypted rumor and never the wrap, so it is
  // recoverable to channel members and invisible to the relay.
  if (kind === KIND_REACTION && opts.targetPubkey) {
    tags.push(["p", opts.targetPubkey]);
  }
  if (kind === KIND_DELETE && opts.target) {
    tags.push(["k", String(opts.targetKind ?? KIND_MESSAGE)]);
  }
  if (opts.extraTags) tags.push(...opts.extraTags);

  // CORD-08 §2. `chatExpiresAt` is what knows which kinds are exempt — a delete
  // and a timer notice must outlive the timer, or turning it off would be
  // unannounceable and a tombstone would expire before what it deletes.
  const expiresAt = chatExpiresAt(kind, ms, opts.timerSecs ?? 0);
  if (expiresAt !== undefined) tags.push(["expiration", String(expiresAt)]);

  const rumor = buildRumor({
    kind,
    content: opts.content,
    tags,
    pubkey: opts.pubkey,
    ms,
  });
  const seal = await sealRumor(
    rumor,
    KIND_SEAL_ENCRYPTED,
    channel.current.group,
    signer,
  );
  const wrap = wrapSeal(
    seal,
    channel.current.group,
    expiresAt !== undefined ? { expiration: expiresAt } : undefined,
  );

  return {
    wrap,
    // `rumor.tags`, NOT the local `tags` — `buildRumor` appends the `ms` tag to
    // its own copy, and the id commits to what IT built. Returning the local
    // array would store a row missing sub-second ordering, so a message would
    // sit in one place at send time and another after a reload.
    rumor: { id: rumor.id, kind, content: opts.content, tags: rumor.tags },
    seal,
    ms,
    createdAt: rumor.created_at,
  };
}
