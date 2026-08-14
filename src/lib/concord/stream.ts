/**
 * Concord Private Streams — CORD-01.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/stream.ts`). Wire format.
 *
 * A stream event is a kind-1059 wrap that REVERSES NIP-59: fixed author (the
 * plane's derived stream key), ephemeral `p` tag, and the wrap is encrypted
 * under the stream's NIP-44 self-ECDH conversation key — never the p-tagged
 * key. Inside rides a seal signed by the author's REAL key, around an unsigned
 * rumor carrying the functional kind:
 *
 *   wrap(1059/21059, signed by stream key)
 *     └ seal(20013 encrypted | 20014 plaintext, signed by the author)
 *         └ rumor(unsigned, the functional kind)
 *
 * The encrypted seal (20013) NIP-44-encrypts the rumor again, so no layer can
 * be lifted out as a standalone public event; the plaintext seal (20014,
 * Control Plane only) carries the rumor's JSON string byte-verbatim so a
 * compaction can re-wrap the signed edition into a new epoch (CORD-02 §5).
 */

import {
  decrypt as nip44Decrypt,
  encrypt as nip44Encrypt,
} from "nostr-tools/nip44";
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
} from "nostr-tools/pure";
import type {
  EventTemplate,
  NostrEvent,
  UnsignedEvent,
} from "nostr-tools/pure";

import type { GroupKey, StreamKeyView } from "@/lib/concord/derive";
import {
  KIND_SEAL_ENCRYPTED,
  KIND_SEAL_PLAINTEXT,
  KIND_WRAP,
  KIND_WRAP_EPHEMERAL,
} from "@/lib/concord/kinds";
import type { NostrRumor } from "@/lib/concord/rumor";
import { verifyEventOnce } from "@/lib/concord/verify-cache";

export class StreamError extends Error {
  constructor(
    public code:
      | "decrypt"
      | "parse"
      | "bad-wrap-kind"
      | "bad-wrap-signature"
      | "bad-seal-kind"
      | "bad-seal-signature"
      | "author-mismatch"
      | "bad-rumor-id"
      | "bad-ms"
      | "binding-mismatch"
      | "oversize",
    message: string,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

/** NIP-44 hard plaintext cap; enforced at every layer (CORD-02 Appendix B). */
export const NIP44_MAX_PLAINTEXT = 65_535;

const TAG_MS = "ms";

function encryptChecked(convKey: Uint8Array, plaintext: string): string {
  // Enforce the cap ourselves — libraries are lenient, and a lenient publisher
  // mints events a strict reader cannot decrypt.
  if (new TextEncoder().encode(plaintext).length > NIP44_MAX_PLAINTEXT) {
    throw new StreamError(
      "oversize",
      "plaintext exceeds the NIP-44 65,535-byte cap",
    );
  }
  return nip44Encrypt(plaintext, convKey);
}

// ── Building ─────────────────────────────────────────────────────────────────

/**
 * Build an unsigned rumor. `ms` is the full send time in epoch-milliseconds:
 * `created_at` carries the seconds, the `ms` tag the 0..999 remainder, and the
 * true event time is `created_at * 1000 + ms` (CORD-02 §4). Pass `ms: null`
 * for rumors that don't carry sub-second ordering (control editions).
 */
export function buildRumor(opts: {
  kind: number;
  content: string;
  tags?: string[][];
  pubkey: string;
  ms?: number | null;
  createdAtSecs?: number;
}): NostrRumor {
  const tags = [...(opts.tags ?? [])];
  let createdAt: number;
  if (opts.ms === null || opts.ms === undefined) {
    createdAt = opts.createdAtSecs ?? Math.floor(Date.now() / 1000);
  } else {
    // A negative or non-integer send time would mint a malformed `ms` tag
    // (e.g. "-123"), which every reader drops as out-of-range (CORD-02 §5).
    // A glitched clock is a local fault, not a reason to publish garbage: fail
    // closed rather than emit an un-decodable event.
    if (!Number.isFinite(opts.ms) || opts.ms < 0) {
      throw new StreamError(
        "bad-ms",
        `send time must be a non-negative epoch-ms, got ${opts.ms}`,
      );
    }
    createdAt = Math.floor(opts.ms / 1000);
    tags.push([TAG_MS, (Math.floor(opts.ms) % 1000).toString()]);
  }
  const unsigned: UnsignedEvent = {
    kind: opts.kind,
    content: opts.content,
    tags,
    created_at: createdAt,
    pubkey: opts.pubkey,
  };
  return { ...unsigned, id: getEventHash(unsigned) };
}

/** The minimal signer surface stream sends need. */
export interface StreamSigner {
  signEvent(template: EventTemplate): Promise<NostrEvent>;
}

/**
 * Seal a rumor with the author's REAL identity: an encrypted seal (20013)
 * NIP-44s the rumor under the stream conversation key first; a plaintext seal
 * (20014) carries the rumor's serialized JSON verbatim. The seal is what the
 * author actually signs — one signer round-trip per send.
 */
export async function sealRumor(
  rumor: NostrRumor,
  sealKind: typeof KIND_SEAL_ENCRYPTED | typeof KIND_SEAL_PLAINTEXT,
  stream: StreamKeyView,
  signer: StreamSigner,
): Promise<NostrEvent> {
  const rumorJson = JSON.stringify(rumor);
  const content =
    sealKind === KIND_SEAL_ENCRYPTED
      ? encryptChecked(stream.convKey, rumorJson)
      : rumorJson;
  return signer.signEvent({
    kind: sealKind,
    content,
    tags: [],
    created_at: rumor.created_at,
  });
}

/**
 * Wrap a signed seal into the outer stream event: encrypted under the stream
 * conversation key, signed by the stream key, tagged with a random ephemeral
 * `p` (NIP-59 reversed). `created_at` is NOT tweaked (CORD-01). Keep
 * `ephemeralSk` if you want to NIP-09-delete the wrap later.
 *
 * `expiration` (unix seconds) puts a NIP-40 tag on the WRAP so relays purge the
 * ciphertext itself — CORD-08 §2's deliberate exception to the no-outer-tags
 * rule, used only for expiring chat rumors and always matching the rumor's own
 * signed `expiration` tag (which is what readers enforce).
 */
export function wrapSeal(
  seal: NostrEvent,
  stream: GroupKey,
  opts?: { ephemeral?: boolean; ephemeralSk?: Uint8Array; expiration?: number },
): NostrEvent {
  const ephemeralSk = opts?.ephemeralSk ?? generateSecretKey();
  const ephemeralPk = getPublicKey(ephemeralSk);
  const tags: string[][] = [["p", ephemeralPk]];
  if (opts?.expiration !== undefined) {
    tags.push(["expiration", String(Math.floor(opts.expiration))]);
  }
  return finalizeEvent(
    {
      kind: opts?.ephemeral ? KIND_WRAP_EPHEMERAL : KIND_WRAP,
      content: encryptChecked(stream.convKey, JSON.stringify(seal)),
      tags,
      created_at: Math.floor(Date.now() / 1000),
    },
    stream.sk,
  );
}

// ── Opening ──────────────────────────────────────────────────────────────────

/**
 * A fully-opened, verified stream event.
 *
 * The ENVELOPE fields below are optional because they exist only while the wrap
 * is in hand. Nothing about the wrap is persisted: the store holds the rumor
 * its author signed and nothing else, so an event read back from it has the
 * rumor fields and none of these. {@link OpenedWireEvent} is the variant
 * straight off a wrap, where all of them are present — take that type wherever
 * the envelope is actually required, and the compiler will keep a stored event
 * out.
 */
export interface OpenedEvent {
  /** The rumor id — the message id / dedup / display key. */
  rumorId: string;
  /** Verified real author (the seal's signer; equals the rumor's pubkey). */
  author: string;
  kind: number;
  content: string;
  tags: string[][];
  /** Ordering timestamp (epoch ms): `created_at*1000 + ms`. */
  ms: number;
  createdAt: number;
  /** WIRE ONLY. The wrap's id (the relay-addressable carrier; the transport dedup key). */
  wrapId?: string;
  /** WIRE ONLY. The stream address (wrap author) this event was read from. */
  streamPk?: string;
  /**
   * WIRE ONLY. Which seal form carried the rumor (20013 encrypted / 20014
   * plaintext). Checked at ingest against the plane rules; afterwards the
   * rumor's own kind implies it, so no reader needs it.
   */
  sealKind?: number;
  /** WIRE ONLY. The verified seal event itself — needed to re-wrap plaintext seals. */
  seal?: NostrEvent;
}

/** An {@link OpenedEvent} straight off a wrap, whose envelope is always present. */
export type OpenedWireEvent = OpenedEvent & {
  wrapId: string;
  streamPk: string;
  sealKind: number;
  seal: NostrEvent;
};

/**
 * Reconstruct the ms timestamp. A missing tag means offset 0; a malformed tag
 * (outside 0..999, non-integer) throws — CORD-02 §5 treats out-of-range `ms`
 * as malformed rather than clamping it, or the excess would smuggle arbitrary
 * "future" past the clock check.
 */
export function resolveMs(createdAtSecs: number, tags: string[][]): number {
  const tag = tags.find((t) => t[0] === TAG_MS);
  if (!tag) return createdAtSecs * 1000;
  // Strict decimal only: `Number()` would accept "", "0x1f", "1e2", " 5 ",
  // "+5" — and two clients disagreeing on accept/reject would diverge on the
  // ordering basis every comparison rides (CORD-02 §4/§5). The value is the
  // 0..999 sub-second remainder as a plain decimal with no leading zeros
  // beyond a bare "0".
  const raw = tag[1];
  if (raw === undefined || !/^(0|[1-9][0-9]{0,2})$/.test(raw)) {
    throw new StreamError("bad-ms", `malformed ms tag: ${raw}`);
  }
  const n = Number(raw);
  if (n > 999) {
    throw new StreamError("bad-ms", `malformed ms tag: ${raw}`);
  }
  return createdAtSecs * 1000 + n;
}

/**
 * Open and fully verify one stream wrap under its plane's group key:
 *
 *   1. the wrap's author must be the stream address (else it isn't ours);
 *      the wrap's OWN signature is never checked for an ordinary stream — it
 *      is made by a key every reader holds and proves nothing, which is why
 *      this takes a rumor and a parked wrap can be stored without one;
 *   2. decrypt the wrap → the seal; verify the seal's Schnorr signature
 *      (authorship proof) and that its kind declares a known seal form;
 *   3. recover the rumor (decrypting again for 20013); verify the rumor's id
 *      is its NIP-01 hash (an id is the ordering tiebreak — never trust a
 *      claimed one) and that the rumor's pubkey equals the seal's signer (or a
 *      keyholder could re-seal another member's rumor under their own name).
 */
export function openWrap(
  wrap: NostrRumor,
  stream: StreamKeyView,
): OpenedWireEvent {
  if (wrap.kind !== KIND_WRAP && wrap.kind !== KIND_WRAP_EPHEMERAL) {
    throw new StreamError(
      "bad-wrap-kind",
      `not a stream wrap: kind ${wrap.kind}`,
    );
  }
  if (wrap.pubkey !== stream.pk) {
    throw new StreamError(
      "author-mismatch",
      "wrap author is not this stream's address",
    );
  }
  // A WRITE-RESTRICTED stream's wrap signature is the write gate (CORD-01):
  // the signer set is narrower than the readership, so unlike an ordinary
  // stream wrap it proves a `control_root` holder published this, and a reader
  // MUST check it rather than lean on the relays having done so.
  if (stream.restricted) {
    const signed = wrap as NostrRumor & { sig?: string };
    if (
      typeof signed.sig !== "string" ||
      !verifyEventOnce(signed as NostrEvent)
    ) {
      throw new StreamError(
        "bad-wrap-signature",
        "write-restricted wrap signature invalid",
      );
    }
  }

  let seal: NostrEvent;
  try {
    seal = JSON.parse(nip44Decrypt(wrap.content, stream.convKey)) as NostrEvent;
  } catch (e) {
    throw new StreamError(
      "decrypt",
      `wrap decrypt: ${e instanceof Error ? e.message : e}`,
    );
  }
  if (seal.kind !== KIND_SEAL_ENCRYPTED && seal.kind !== KIND_SEAL_PLAINTEXT) {
    throw new StreamError("bad-seal-kind", `unknown seal kind ${seal.kind}`);
  }
  // Memoized by seal id: the same wrap arrives from every relay serving the
  // community, and each delivery re-parses the seal into a fresh object, so
  // nostr-tools' per-object memo never hits. The id is the seal's content hash
  // and is recomputed from THIS copy before the memo is consulted, so a
  // duplicate cannot ride a known-good id.
  if (!verifyEventOnce(seal)) {
    throw new StreamError("bad-seal-signature", "seal signature invalid");
  }

  let rumor: NostrRumor;
  try {
    const json =
      seal.kind === KIND_SEAL_ENCRYPTED
        ? nip44Decrypt(seal.content, stream.convKey)
        : seal.content;
    rumor = JSON.parse(json) as NostrRumor;
  } catch (e) {
    throw new StreamError(
      seal.kind === KIND_SEAL_ENCRYPTED ? "decrypt" : "parse",
      `rumor recover: ${e instanceof Error ? e.message : e}`,
    );
  }

  if (rumor.pubkey !== seal.pubkey) {
    throw new StreamError(
      "author-mismatch",
      "rumor author does not match the seal's signer",
    );
  }
  const expectedId = getEventHash({
    kind: rumor.kind,
    content: rumor.content,
    tags: rumor.tags,
    created_at: rumor.created_at,
    pubkey: rumor.pubkey,
  });
  if (rumor.id !== expectedId) {
    throw new StreamError("bad-rumor-id", "rumor id is not its event hash");
  }

  return {
    rumorId: rumor.id,
    author: seal.pubkey,
    kind: rumor.kind,
    content: rumor.content,
    tags: rumor.tags,
    ms: resolveMs(rumor.created_at, rumor.tags),
    createdAt: rumor.created_at,
    wrapId: wrap.id,
    streamPk: wrap.pubkey,
    sealKind: seal.kind,
    seal,
  };
}

/**
 * Re-wrap an already-verified seal into another stream (a compaction, CORD-06).
 * Only meaningful for plaintext seals, whose signature survives the re-wrap;
 * the seal object's `content` string is carried forward verbatim.
 */
export function rewrapSeal(
  seal: NostrEvent,
  targetStream: GroupKey,
): NostrEvent {
  if (seal.kind !== KIND_SEAL_PLAINTEXT) {
    throw new StreamError(
      "bad-seal-kind",
      "only plaintext seals survive a re-wrap",
    );
  }
  return wrapSeal(seal, targetStream);
}

// ── Chat-plane binding (CORD-03 §3) ──────────────────────────────────────────

const TAG_CHANNEL = "channel";
const TAG_EPOCH = "epoch";

/** The binding tags a Chat rumor MUST commit: `["channel", id]` + `["epoch", n]`. */
export function channelBindingTags(
  channelIdHex: string,
  epoch: bigint,
): string[][] {
  return [
    [TAG_CHANNEL, channelIdHex],
    [TAG_EPOCH, epoch.toString()],
  ];
}

/** Value of a tag required to appear AT MOST ONCE (binding must be unambiguous). */
function uniqueTag(tags: string[][], name: string): string | undefined {
  let found: string | undefined;
  for (const t of tags) {
    if (t[0] === name) {
      if (found !== undefined) {
        throw new StreamError(
          "binding-mismatch",
          `duplicate binding tag: ${name}`,
        );
      }
      found = t[1];
    }
  }
  return found;
}

/**
 * Enforce the Chat-plane binding: the rumor's committed channel + epoch must
 * strict-equal the coordinate whose key decrypted the wrap, or a keyholder
 * could splice one author's rumor into a context they never chose.
 */
export function checkChannelBinding(
  opened: OpenedEvent,
  channelIdHex: string,
  epoch: bigint,
): void {
  if (uniqueTag(opened.tags, TAG_CHANNEL) !== channelIdHex) {
    throw new StreamError(
      "binding-mismatch",
      "channel-binding mismatch (splice)",
    );
  }
  if (uniqueTag(opened.tags, TAG_EPOCH) !== epoch.toString()) {
    throw new StreamError(
      "binding-mismatch",
      "epoch-binding mismatch (splice)",
    );
  }
}
