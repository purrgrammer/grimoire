/**
 * Concord event-kind registry — CORD-02 Appendix B (frozen).
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/kinds.ts`).
 *
 * Every durable plane event is a kind-1059 wrap around a seal (CORD-01); the
 * INNER rumor carries the functional kind. Standard kinds are reused where one
 * fits (9 message, 7 reaction, 5 delete); the dedicated 33xx block covers the
 * rest. Retired numbers (3300, 3301, 3304, 3305, 3307, 3311, 23308) are burned
 * forever and never appear here.
 *
 * Kinds grimoire does not produce are still listed. The registry is frozen, so
 * knowing a number is claimed is what stops a later addition colliding with it,
 * and the plane boundary below has to recognise every kind it must refuse.
 */

// ── Envelope kinds (CORD-01) ─────────────────────────────────────────────────

/** Durable gift wrap (the outer envelope of every stored plane event). */
export const KIND_WRAP = 1059;
/** Ephemeral gift wrap — identical structure, relays MUST NOT store it. */
export const KIND_WRAP_EPHEMERAL = 21059;
/** Encrypted seal: the rumor is NIP-44-encrypted again inside the wrap. */
export const KIND_SEAL_ENCRYPTED = 20013;
/** Plaintext seal: the seal's content is the rumor's JSON string, byte-verbatim. */
export const KIND_SEAL_PLAINTEXT = 20014;

// ── Chat Plane rumor kinds ───────────────────────────────────────────────────

/** Chat message (NIP-C7 shape; `q` tags are inline quote-replies, NOT threads). */
export const KIND_MESSAGE = 9;
/**
 * Threaded reply (NIP-22 comment). A thread reply is a kind-1111 rumor pointing
 * at its thread root (`K`/`E`/`P`) and immediate parent (`k`/`e`/`p`), NOT a
 * kind-9 message with a `q` tag — `q` is reserved for inline quote-replies per
 * NIP-C7, and conflating the two is a rendering bug in every other client.
 */
export const KIND_COMMENT = 1111;
/** Reaction (NIP-25 shape). */
export const KIND_REACTION = 7;
/** Delete (NIP-09 shape; names the author's own rumor ids). */
export const KIND_DELETE = 5;
/** Message edit (fields not yet pinned by the CORDs; `e` names the target). */
export const KIND_EDIT = 3302;
/**
 * Disappearing-messages timer notice (CORD-08 §4): posted by staff into each
 * channel after changing the community's `message_expiration`, carrying the new
 * value in a `["timer", "<seconds>"]` tag ("0" = turned off). The same kind and
 * tag NIP-17 disappearing-DM clients use. Informational — the metadata fold is
 * the authority — and displayed only when its author holds MANAGE_METADATA.
 * Never carries an `expiration` tag itself.
 */
export const KIND_TIMER_NOTICE = 1740;

// Armada client extensions (CORD.md), recognised so they are neither rendered
// as raw events nor mistaken for plane traffic. Grimoire does not produce them.
/** Private zap: NIP-57 receipt shape authored by the PAYER, `preimage` as proof. */
export const KIND_ZAP = 9735;
/** On-chain Bitcoin zap attribution. */
export const KIND_ONCHAIN_ZAP = 8333;
/** NIP-88 poll, sealed as a Chat Plane rumor. */
export const KIND_POLL = 1068;
/** NIP-88 vote — an `e`-referencing side event, never its own timeline row. */
export const KIND_POLL_VOTE = 1018;
/** NIP-52 calendar events, surfaced outside the timeline. */
export const KIND_CALENDAR_DATE = 31922;
export const KIND_CALENDAR_TIME = 31923;
/** NIP-52 RSVP, an `e`-referencing side event like a vote. */
export const KIND_CALENDAR_RSVP = 31925;
/** WebXDC peer signal. */
export const KIND_WEBXDC = 3310;

/**
 * The rumor kinds that occupy a TIMELINE ROW.
 *
 * `foldTimeline` is the source of truth (`chat.ts`, the branch that fills
 * `timeline.messages`) and this set must stay equal to it: anything counted as
 * unread that the fold does not render is a badge no reader can clear, and
 * anything rendered but not counted is a channel that lights up with no badge.
 *
 * Side events (votes, RSVPs, reactions, deletes, edits) decorate a row rather
 * than being one. Timer notices (1740) are rendered separately from the message
 * pool by the fold and are deliberately out.
 */
export const TIMELINE_KINDS: ReadonlySet<number> = new Set([
  KIND_MESSAGE,
  KIND_COMMENT,
  KIND_POLL,
  KIND_CALENDAR_DATE,
  KIND_CALENDAR_TIME,
]);

/** Typing indicator — ephemeral rumor (rides a 21059 wrap). */
export const KIND_TYPING = 23311;
/** Voice presence (CORD-07 §4) — ephemeral rumor. Grimoire does not do calls. */
export const KIND_VOICE_PRESENCE = 23313;

// ── Guestbook Plane rumor kinds ──────────────────────────────────────────────

/** Join / Leave: self-signed, the content is the verb. */
export const KIND_JOIN_LEAVE = 3306;
/** Kick: admin-signed, names its target, cites its Grant (`vac`). */
export const KIND_KICK = 3309;
/** Guestbook snapshot: refounder-signed, chunked at 400 members. */
export const KIND_SNAPSHOT = 3312;

// ── Person-addressed rumor kinds (standard NIP-59, not stream traffic) ──────

/**
 * Direct invite (CORD-05 §6): the invite bundle giftwrapped straight to an npub
 * — a kind-13 seal signed by the inviter's REAL key inside an ephemeral-author,
 * recipient-`p`-tagged 1059 wrap (classic NIP-59, NOT the reversed stream wrap).
 */
export const KIND_DIRECT_INVITE = 3313;

// ── Control / rekey rumor kinds ──────────────────────────────────────────────

/** Control edition (sub-kinded by the `vsk` tag). */
export const KIND_CONTROL = 3308;
/** Rekey blobs (CORD-06), delivered at rekey addresses. */
export const KIND_REKEY = 3303;

// ── Bare kinds (outside the wrap) ────────────────────────────────────────────

/** Public invite bundle: addressable, signed by the per-link keypair, empty `d`. */
export const KIND_INVITE_BUNDLE = 33301;
/** A member's self-encrypted Community List (replaceable, one per user). */
export const KIND_COMMUNITY_LIST = 13302;
/** A creator's self-encrypted Invite List (replaceable, one per user). */
export const KIND_INVITE_LIST = 13303;

// ── Control edition sub-kinds (the `vsk` tag) ────────────────────────────────

export const VSK_METADATA = "0";
export const VSK_ROLE = "1";
export const VSK_CHANNEL = "2";
export const VSK_GRANT = "3";
export const VSK_BANLIST = "4";
// 5 reserved (role ordering); 6/9 claimed by the addressable invite marker;
// 7 retired (v1 owner attestation).
export const VSK_INVITE_REGISTRY = "8";
export const VSK_DISSOLVED = "10";
export const VSK_PINS = "11";
/**
 * Community Signals — armada ships this from the spec's UNMERGED
 * `community-signals` branch, so grimoire records the claimed number and
 * enforces nothing. An unknown `vsk` folds to nothing (never throws), which is
 * what makes ignoring it safe; the visible consequence is that a paused
 * community will not appear paused here.
 */
export const VSK_SIGNALS = "12";

/** Invite-bundle marker values for its `vsk` tag: live vs revocation tombstone. */
export const VSK_INVITE_LIVE = "6";
export const VSK_INVITE_REVOKED = "9";

// ── Plane rules (CORD-02 §5) ─────────────────────────────────────────────────

/**
 * The stream planes whose stored rumors are read back BY KIND.
 *
 * Chat is not one of them: it is read back by `#channel` tag, bound to the
 * stream key that decrypted it by `checkChannelBinding`, and its kinds overlap
 * nothing here.
 */
export type Plane = "control" | "guestbook" | "rekey";

/**
 * What each plane may carry: its rumor kinds, and the seal form CORD-02 §5
 * fixes for it.
 *
 * This is the WHOLE mapping, and it is total — which is why neither fact needs
 * to be stored beside a rumor. The seal form is a function of the kind (3308 is
 * plaintext because a control edition must survive a compaction re-wrap;
 * everything else is encrypted), and the kind sets are disjoint, so the plane a
 * stored rumor belongs to is a property of the rumor itself.
 *
 * Meant to be enforced ONCE, at ingest, against the plane whose keys actually
 * opened the wrap. That is what makes the kind sufficient afterwards: without
 * it, a holder of any one plane's stream key could wrap a rumor of another
 * plane's kind and have it read back as that plane's — the read is a kind
 * query, and a kind is just data the wrapper chose.
 *
 * NOTHING ENFORCES THIS YET. These two exports are the contract for the store
 * that does not exist here; whoever builds it MUST apply both fences, or a
 * channel keyholder can wrap a kind-3308 rumor carrying a valid channel
 * binding and have the plane read serve it as a control edition.
 */
export const PLANE_RULES: Record<Plane, { kinds: number[]; sealKind: number }> =
  {
    control: { kinds: [KIND_CONTROL], sealKind: KIND_SEAL_PLAINTEXT },
    guestbook: {
      kinds: [KIND_JOIN_LEAVE, KIND_KICK, KIND_SNAPSHOT],
      sealKind: KIND_SEAL_ENCRYPTED,
    },
    rekey: { kinds: [KIND_REKEY], sealKind: KIND_SEAL_ENCRYPTED },
  };

/**
 * Every kind claimed by a non-chat plane — the set the CHAT ingress refuses.
 *
 * The other half of the plane boundary. A community's planes share one store
 * and a plane is read back by kind, so the two ingresses have to fence each
 * other: a plane write refuses a `channel` tag (which would put it in a
 * timeline), and a chat write refuses these kinds (which would put it in a
 * plane). Without this a holder of any ONE channel's stream key could wrap a
 * kind-3308 rumor carrying a valid channel binding and have the plane read
 * serve it as a control edition — and nothing downstream would catch it, since
 * a stored rumor has no seal left for the edition parser to check the form of.
 */
export const PLANE_KINDS: ReadonlySet<number> = new Set(
  Object.values(PLANE_RULES).flatMap((rule) => rule.kinds),
);
