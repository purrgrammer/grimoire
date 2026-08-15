/**
 * The Concord opened-event store — decrypted rumors, and the plane boundary.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/rumorStore.ts`), narrowed to
 * what a read client needs and re-backed on grimoire's single Dexie database.
 *
 * Concord traffic arrives as opaque kind-1059 wraps (CORD-01). Wraps are never
 * persisted: caching ciphertext means every cold read re-runs two NIP-44 opens
 * and a Schnorr verify. Instead a wrap is decrypted once at ingest and the
 * recovered rumor — EXACTLY as its author signed it — is what is stored, so a
 * plane or channel read is an ordinary indexed query with no crypto.
 *
 * One exception, added by the wire: a wrap the client holds NO key for is parked
 * (see the parked-wrap section at the bottom). It cannot be opened, so there is
 * no rumor to store in its place, and a standing subscription has no later
 * chance to re-fetch it.
 *
 * ## The plane boundary (do not remove either fence)
 *
 * Armada isolates communities with a database per community. Grimoire has one
 * Dexie, so isolation is a `communityId` column that is in EVERY index and MUST
 * be in every query. On top of that, `writeOpened` enforces both halves of
 * CORD-02 §5's plane rules, checked ONCE here against the plane whose stream
 * keys actually opened the wrap:
 *
 * - a plane rumor must be one of that plane's kinds, under that plane's seal
 *   form (`PLANE_RULES`), and must carry NO `channel` tag;
 * - a chat rumor (`writeChatRumors`) must NOT carry any plane's kind.
 *
 * They fence each other because planes share the store and a plane is read back
 * BY KIND. Without them, a holder of any ONE channel's stream key could wrap a
 * kind-3308 rumor carrying a valid channel binding and have `queryPlane` serve
 * it as a control edition — and nothing downstream would catch it, because a
 * stored rumor has no seal left for the edition parser to check the form of.
 *
 * Rejecting rather than stripping keeps the stored row byte-identical to the
 * rumor its author signed, which is what the rumor id commits to.
 *
 * Trust note: this persists DECRYPTED plane data at rest, the same device-trust
 * level as the membership vault beside it. Wiped on logout.
 */

import type { NostrEvent } from "nostr-tools";

import type { FoldedControl } from "@/lib/concord/control";
import { isExpired } from "@/lib/concord/disappearing";
import {
  KIND_COMMENT,
  KIND_MESSAGE,
  KIND_REKEY,
  PLANE_KINDS,
  PLANE_RULES,
  type Plane,
} from "@/lib/concord/kinds";
import type { OpenedEvent, OpenedWireEvent } from "@/lib/concord/stream";
import { resolveMs } from "@/lib/concord/stream";
import db, { type ConcordRumorRow } from "@/services/db";

/** The chat plane's channel binding (CORD-03 §3) — the tag chat reads index. */
const TAG_CHANNEL = "channel";

/**
 * What a write actually achieved.
 *
 * `wrapIds` is the wraps whose rumors are now in the store — NOT the wraps that
 * opened. Both writers REJECT rumors here (a plane rumor carrying a channel tag,
 * a chat rumor carrying a plane's kind, an already-expired one), and a caller
 * that treats "it decoded" as "it is stored" will ack a parked wrap that was
 * refused and delete it for good.
 *
 * `ok` is false only when the write itself failed — storage pressure, a blocked
 * upgrade. A refusal is a successful write of nothing.
 */
export interface WriteResult {
  ok: boolean;
  wrapIds: string[];
}

/** The wrap ids among rows the store accepted. Envelope-only, so often empty. */
function acceptedWrapIds(rows: Array<{ wrapId?: string }>): string[] {
  const out: string[] = [];
  for (const row of rows) if (row.wrapId) out.push(row.wrapId);
  return out;
}

// ── Codec ────────────────────────────────────────────────────────────────────
//
// The stored row IS the recovered rumor: `id` the rumor id (the NIP-01 hash),
// `pubkey` the REAL author (so a NIP-09 self-delete matches), `tags` the
// author's own, and no `sig`. The one envelope fact kept is the control
// snapshot membership, below — everything else about the wrap is discarded.

function toRow(
  communityId: string,
  opened: OpenedEvent,
  channel?: string,
): ConcordRumorRow {
  return {
    id: opened.rumorId,
    communityId,
    kind: opened.kind,
    ...(channel !== undefined ? { channel } : {}),
    created_at: opened.createdAt,
    pubkey: opened.author,
    content: opened.content,
    tags: opened.tags,
  };
}

/** Reconstruct an {@link OpenedEvent} from a stored row. */
export function rowToOpened(row: ConcordRumorRow): OpenedEvent {
  return {
    rumorId: row.id,
    author: row.pubkey,
    kind: row.kind,
    content: row.content,
    tags: row.tags,
    createdAt: row.created_at,
    // Recomputed from the stored tags rather than persisted: `ms` is a pure
    // function of them, and a malformed tag would already have thrown at
    // ingest. A row that somehow carries one falls back to second precision
    // rather than poisoning a read.
    ms: safeMs(row.created_at, row.tags),
  };
}

function safeMs(createdAt: number, tags: string[][]): number {
  try {
    return resolveMs(createdAt, tags);
  } catch {
    return createdAt * 1000;
  }
}

// ── Control snapshot membership ──────────────────────────────────────────────
//
// ONE envelope fact is genuinely not in the rumor: whether a control edition
// arrived under the CURRENT epoch's control stream. A Refounding's compaction
// re-wraps editions VERBATIM under the new epoch's address (CORD-06 §3), so the
// bytes — and therefore the rumor id — are identical either way, and the fold
// needs the distinction because a compaction snapshot outranks old-root
// fragments. So that, and only that, is kept: a set of rumor ids per control
// stream address. Writers are dumb (a rumor's id joins the set for the address
// it arrived on) and the reader asks for the address it considers current, so
// nothing has to agree about which epoch is live at write time.

/**
 * The rumor ids that arrived under `controlPk`, or undefined if none did.
 *
 * A SUPERSET of what the store still holds, which is harmless: every caller
 * uses it to filter editions it has already read out of the store.
 */
export async function readControlSnapshot(
  communityId: string,
  controlPk: string,
): Promise<Set<string> | undefined> {
  if (!communityId || !controlPk) return undefined;
  try {
    const row = await db.concordSnapshots.get([communityId, controlPk]);
    return row && row.rumorIds.length > 0 ? new Set(row.rumorIds) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record which control stream each fresh rumor arrived on.
 *
 * Read-modify-write per address, last-writer-wins: a lost update costs nothing,
 * because the control plane is swept in COMPLETE mode and the next sweep
 * re-offers the whole plane.
 *
 * Only worth keeping for a REFOUNDED community — one that has never rotated has
 * no compaction to distinguish, and writing it anyway grows an id list nothing
 * reads. `writeOpened` gates on that, defaulting to true: a caller that cannot
 * tell gets a set that costs something and is correct, rather than a missing
 * one that anchors the fold on nothing.
 */
export async function noteControlSnapshot(
  communityId: string,
  opened: Array<{ streamPk?: string; rumorId: string }>,
): Promise<void> {
  const byPk = new Map<string, string[]>();
  for (const o of opened) {
    if (!o.streamPk) continue;
    const list = byPk.get(o.streamPk);
    if (list) list.push(o.rumorId);
    else byPk.set(o.streamPk, [o.rumorId]);
  }
  await Promise.all(
    [...byPk].map(async ([controlPk, ids]) => {
      const existing = await db.concordSnapshots.get([communityId, controlPk]);
      const merged = new Set(existing?.rumorIds ?? []);
      const before = merged.size;
      for (const id of ids) merged.add(id);
      if (merged.size === before) return;
      await db.concordSnapshots.put({
        communityId,
        controlPk,
        rumorIds: [...merged],
        updatedAt: Date.now(),
      });
    }),
  );
}

/**
 * Forget the snapshot sets of every control address except `keepPks` (the ones
 * whose keys the community still holds), so retired epochs don't accumulate id
 * lists forever. Best-effort.
 */
export async function pruneControlSnapshots(
  communityId: string,
  keepPks: string[],
): Promise<void> {
  if (!communityId) return;
  try {
    const keep = new Set(keepPks);
    const rows = await db.concordSnapshots
      .where("communityId")
      .equals(communityId)
      .toArray();
    const stale = rows.filter((r) => !keep.has(r.controlPk));
    await Promise.all(
      stale.map((r) =>
        db.concordSnapshots.delete([r.communityId, r.controlPk]),
      ),
    );
  } catch {
    // best-effort
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Persist opened stream events for one PLANE (chat has its own door — see
 * {@link writeChatRumors}).
 *
 * Resolves to WHETHER the batch committed, and never rejects. The distinction
 * matters to exactly one caller and matters absolutely: the sweep memoises a
 * wrap as processed once its rumor is stored, and a memo advanced over a failed
 * write leaves a rumor that never reached the store and is never decrypted
 * again — the one way a completely-swept plane can lose an event.
 *
 * THIS IS THE PLANE BOUNDARY. See the module docstring for what each refusal
 * buys and why stripping is not an option.
 *
 * `refounded` says whether this community has ever rotated its root, i.e.
 * whether {@link readControlSnapshot} will ever be asked about it. DEFAULTS TO
 * TRUE: a caller that doesn't know gets a set that costs something and is
 * correct, not a missing one.
 */
export async function writeOpened(
  communityId: string,
  opened: OpenedWireEvent[],
  plane: Plane,
  opts: { refounded?: boolean } = {},
): Promise<WriteResult> {
  const rule = PLANE_RULES[plane];
  const allowed = opened.filter(
    (o) =>
      rule.kinds.includes(o.kind) &&
      o.sealKind === rule.sealKind &&
      !o.tags.some((t) => t[0] === TAG_CHANNEL),
  );
  if (allowed.length === 0 || !communityId) return { ok: true, wrapIds: [] };
  try {
    await db.concordRumors.bulkPut(allowed.map((o) => toRow(communityId, o)));
    if (plane === "control" && (opts.refounded ?? true)) {
      await noteControlSnapshot(communityId, allowed);
    }
    return { ok: true, wrapIds: acceptedWrapIds(allowed) };
  } catch (error) {
    console.warn("[concord] plane write failed:", error);
    return { ok: false, wrapIds: [] };
  }
}

/**
 * Persist opened CHAT rumors, whose `channel` binding rides through — the chat
 * decode path has already proved it equals the coordinate whose key opened the
 * wrap (`checkChannelBinding`).
 *
 * The other half of the plane boundary: `writeOpened` refuses a plane rumor
 * carrying a channel tag, this refuses a chat rumor carrying a plane's kind.
 *
 * Note kind 5 is NOT among any plane's kinds — NIP-09 deletes are a chat-plane
 * affair, and no non-chat plane publishes one.
 */
export async function writeChatRumors(
  communityId: string,
  opened: Array<OpenedEvent & { channel: string; wrapId?: string }>,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<WriteResult> {
  // Already-expired rumors are refused at ingest (CORD-08 §3). Storing one only
  // hands the read filter something to hide and the local sweep something to
  // delete — and in the meantime it sits in Dexie as plaintext at rest, which is
  // exactly what the sender asked would not happen.
  const allowed = opened.filter(
    (o) => !PLANE_KINDS.has(o.kind) && !isExpired(o.tags, nowSecs),
  );
  if (allowed.length === 0 || !communityId) return { ok: true, wrapIds: [] };
  try {
    await db.concordRumors.bulkPut(
      allowed.map((o) => toRow(communityId, o, o.channel.toLowerCase())),
    );
    return { ok: true, wrapIds: acceptedWrapIds(allowed) };
  } catch (error) {
    console.warn("[concord] chat write failed:", error);
    return { ok: false, wrapIds: [] };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Every stored rumor of a plane's kinds, for one community.
 *
 * The plane's kinds ARE its identity in the store: `writeOpened` refused
 * anything else at ingest, checked against the stream keys that actually opened
 * the wrap, so a rumor of this plane's kind being here means it arrived on this
 * plane. That is what replaces a by-stream-address read — the addresses are
 * derived per epoch, so selecting on them would mean storing an address per
 * rumor, and the kind does the same work with nothing stored.
 */
export async function queryPlane(
  communityId: string,
  plane: Exclude<Plane, "rekey">,
): Promise<OpenedEvent[]> {
  const kinds = PLANE_RULES[plane].kinds;
  const rows = await db.concordRumors
    .where("[communityId+kind]")
    .anyOf(kinds.map((kind) => [communityId, kind]))
    .toArray();
  return rows.map(rowToOpened);
}

/**
 * The stored rekey rounds for specific (scope, new-epoch) targets.
 *
 * A rekey address is `f(root, scope, epoch)`, so selecting rounds by address
 * would mean storing the address. The rumor names the same two things ITSELF,
 * in the `scope` and `newepoch` tags `parseRekey` already reads and validates,
 * so this is one indexed read on the kind plus an in-memory tag match.
 *
 * Nothing is given up by not selecting on the address: every member derives
 * rekey addresses from the community root they all hold, so publishing to one
 * was never restricted either. A round's authority is its CORD-04 §5 citation,
 * checked against the roster by the caller.
 */
export async function queryRekeyRounds(
  communityId: string,
  targets: Array<{ scopeIdHex: string; newEpoch: bigint }>,
): Promise<OpenedEvent[]> {
  if (!communityId || targets.length === 0) return [];
  const want = new Set(
    targets.map((t) => `${t.scopeIdHex.toLowerCase()}:${t.newEpoch}`),
  );
  const rows = await db.concordRumors
    .where("[communityId+kind]")
    .equals([communityId, KIND_REKEY])
    .toArray();
  const out: OpenedEvent[] = [];
  for (const row of rows) {
    const scope = row.tags.find((t) => t[0] === "scope")?.[1]?.toLowerCase();
    const epoch = row.tags.find((t) => t[0] === "newepoch")?.[1];
    if (!scope || !epoch) continue;
    if (want.has(`${scope}:${epoch}`)) out.push(rowToOpened(row));
  }
  return out;
}

/**
 * Every author this community has been SEEN publishing a message under, mapped
 * to the newest ms they were seen at.
 *
 * The other half of the Complete Memberlist (CORD-02 §5): an author seen
 * publishing is observably present, whatever the Guestbook does or does not say
 * — which is what lets grimoire publish no Join at all and still appear on
 * every member's roster after one message.
 *
 * Messages and comments ONLY, matching armada's `MembersView`. Its own comment
 * says "anyone seen publishing anywhere", but the code it documents reads these
 * two kinds; a reaction or a delete is a weaker signal and admitting them here
 * would put a departed member back on the roster for reacting once.
 */
export async function observedAuthors(
  communityId: string,
): Promise<Map<string, number>> {
  const seen = new Map<string, number>();
  if (!communityId) return seen;
  try {
    await db.concordRumors
      .where("[communityId+kind]")
      .anyOf([
        [communityId, KIND_MESSAGE],
        [communityId, KIND_COMMENT],
      ])
      .each((row) => {
        const ms = safeMs(row.created_at, row.tags);
        if (ms > (seen.get(row.pubkey) ?? 0)) seen.set(row.pubkey, ms);
      });
  } catch (error) {
    console.warn("[concord] observed-author scan failed:", error);
  }
  return seen;
}

/** Chat kinds that occupy a timeline row. */
const CHAT_ROW_KINDS = [9, 1111, 1068, 31922, 31923, 1740];
/** Chat kinds that decorate another rumor rather than standing alone. */
const CHAT_SIDE_KINDS = [7, 5, 3302];

/**
 * One channel's stored chat rumors, newest first.
 *
 * `limit` budgets the ROWS, and the side events (reactions, deletes, edits) are
 * fetched separately and unbudgeted against it — otherwise a reaction flood on
 * one message displaces the rows it decorates, and the channel reads empty.
 */
export async function queryChannelRumors(
  communityId: string,
  channelIdHex: string,
  opts: { limit: number; until?: number } = { limit: 200 },
): Promise<OpenedEvent[]> {
  const channel = channelIdHex.toLowerCase();
  const inRange = (row: ConcordRumorRow) =>
    opts.until === undefined || row.created_at <= opts.until;

  const all = await db.concordRumors
    .where("[communityId+channel]")
    .equals([communityId, channel])
    .toArray();

  const rows = all.filter(inRange);
  const byNewest = (a: ConcordRumorRow, b: ConcordRumorRow) =>
    b.created_at - a.created_at;
  const rowKinds = new Set(CHAT_ROW_KINDS);
  const sideKinds = new Set(CHAT_SIDE_KINDS);

  const timeline = rows
    .filter((r) => rowKinds.has(r.kind))
    .sort(byNewest)
    .slice(0, opts.limit);
  const oldest =
    timeline.length > 0 ? timeline[timeline.length - 1].created_at : undefined;
  // Side events only for the window the rows cover, so an old reaction cannot
  // resurrect a message that fell outside it.
  const side = rows.filter(
    (r) =>
      sideKinds.has(r.kind) && (oldest === undefined || r.created_at >= oldest),
  );

  return [...timeline, ...side].map(rowToOpened);
}

/**
 * One stored rumor by id, scoped to the channel it must belong to.
 *
 * A direct primary-key read rather than a slice of the timeline. Every caller
 * here is acting on a message the user can SEE — replying to it, reacting to it,
 * deleting it — and the viewer pages backwards without limit, so any windowed
 * lookup refuses on exactly the older messages someone scrolled up to find.
 *
 * The community and channel are re-checked rather than trusted: the id alone
 * would let one channel's action name another channel's rumor.
 */
export async function readChannelRumor(
  communityId: string,
  channelIdHex: string,
  rumorId: string,
): Promise<OpenedEvent | undefined> {
  if (!communityId || !rumorId) return undefined;
  try {
    const row = await db.concordRumors.get(rumorId);
    if (!row || row.communityId !== communityId) return undefined;
    if (row.channel !== channelIdHex.toLowerCase()) return undefined;
    return rowToOpened(row);
  } catch {
    return undefined;
  }
}

// ── The materialized fold ────────────────────────────────────────────────────
//
// Re-deriving the whole fold at every boot is wasted work: parsing every stored
// edition and replaying the delegation fixpoint costs real time on a community
// with thousands of them, and the answer is identical until an edition arrives.
// So the fold is PERSISTED and read back as the first paint.
//
// It is a pure cache. Rejecting it costs one re-fold from editions already on
// disk, so a snapshot this build cannot read is simply a miss.

const foldKey = (communityId: string, epoch: bigint) =>
  `concordFold:${communityId}@${epoch}`;

/**
 * Whether a fold decoded off disk still has the shape this build reads.
 *
 * Dexie rehydrates behind an unchecked cast, so a snapshot written by an older
 * build arrives TYPED as current and is then dereferenced as current. Every Map
 * and Set has to be checked, not a representative sample: a snapshot from a
 * build that predates a field passes every check that field is missing from and
 * then throws on first read. Extend this whenever the persisted shape gains a
 * field a reader assumes is there.
 */
function isCurrentFold(value: unknown): value is FoldedControl {
  const fold = value as FoldedControl | undefined;
  if (!fold || typeof fold.ownerHex !== "string") return false;
  if (!(fold.channels instanceof Map)) return false;
  if (!(fold.heads instanceof Map)) return false;
  if (!(fold.bannedAt instanceof Map)) return false;
  if (!(fold.banned instanceof Set)) return false;
  if (!Array.isArray(fold.incomplete)) return false;
  if (!fold.roster || !Array.isArray(fold.roster.roles)) return false;
  if (!Array.isArray(fold.roster.grants)) return false;
  for (const def of fold.channels.values()) {
    if (!def || typeof def.metadata !== "object" || def.metadata === null) {
      return false;
    }
  }
  return true;
}

/**
 * The persisted fold for this community at this epoch, or undefined on a miss.
 *
 * Keyed by EPOCH as well as community: a Refounding replaces the authoritative
 * edition set, so a fold from a superseded founding must never be served for the
 * new one.
 */
export async function readFoldedControl(
  communityId: string,
  epoch: bigint,
): Promise<FoldedControl | undefined> {
  try {
    const row = await db.concordKv.get(foldKey(communityId, epoch));
    return isCurrentFold(row?.value) ? row.value : undefined;
  } catch {
    return undefined;
  }
}

/** Persist the fold. Best-effort: it is a cache, never a source of truth. */
export async function writeFoldedControl(
  communityId: string,
  epoch: bigint,
  fold: FoldedControl,
): Promise<void> {
  try {
    await db.concordKv.put({ key: foldKey(communityId, epoch), value: fold });
  } catch {
    // Storage pressure must not become a sync problem.
  }
}

/** Wipe one community's stored rumors and snapshots. */
export async function clearCommunityRumors(communityId: string): Promise<void> {
  await db.concordRumors.where("communityId").equals(communityId).delete();
  await db.concordSnapshots.where("communityId").equals(communityId).delete();
}

// ── Parked wraps ─────────────────────────────────────────────────────────────
//
// Ported from armada `bc19d1f` (`parkPendingWraps` / `peekPendingWraps` /
// `ackPendingWraps`). Armada parks because its native background service
// receives wraps with no stream keys to open them; grimoire parks because a
// STANDING subscription delivers wraps for addresses whose keys have not arrived
// yet — a rekey not caught up with, a channel granted moments ago, a spec that
// has not refreshed. Same problem, same shape.
//
// The invariant that makes it loss-proof: a wrap is never removed before its
// rumor is durably stored. So peek READS, and the caller acks only what actually
// decoded and was written. A notified message must never be locally
// destructible.
//
// This is the ONE place a wrap is persisted. See `ConcordPendingWrapRow`.

/** Parked wraps older than this are pruned — the key is never coming. */
const PENDING_MAX_AGE_SECS = 14 * 24 * 3600;

/** How often (ms) to age-prune. Kept off the per-peek path. */
const PENDING_PRUNE_INTERVAL_MS = 5 * 60_000;
let lastPendingPruneAt = 0;

/**
 * Whether the parked store is known to hold nothing worth peeking at:
 *
 * - `true` — provably empty; a peek returns without touching IndexedDB;
 * - `false` — something is (or may be) parked; a peek does the real read;
 * - `undefined` — unknown (fresh session); the FIRST peek probes once.
 *
 * The probe is what keeps this correct across restarts. Wraps parked in a
 * PREVIOUS session are durable and nothing re-parks them, so a plain
 * session-scoped "did we park anything?" boolean would hide them from the drain
 * forever. One `limit: 1` probe finds them; after that the common case — nothing
 * ever parked — keeps the drain off the channel-read hot path.
 */
let pendingKnownEmpty: boolean | undefined;

/**
 * Park wraps the client holds no key for.
 *
 * Resolves TRUE when the wraps are durably parked. The caller needs that answer:
 * the wire advances a durable read cursor over the same batch, and a park that
 * failed silently would leave a wrap neither stored nor parked with the cursor
 * already past it.
 *
 * The known-empty flag flips SYNCHRONOUSLY, before the write lands — a peek
 * racing this must do the real read rather than trust a probe that began before
 * the row existed.
 */
export function parkPendingWraps(wraps: NostrEvent[]): Promise<boolean> {
  if (wraps.length === 0) return Promise.resolve(true);
  // Set BEFORE the write resolves: a peek racing this must do the real read
  // rather than trust a probe that started before the row landed.
  pendingKnownEmpty = false;
  const rows = wraps.map((wrap) => ({
    id: wrap.id,
    pubkey: wrap.pubkey,
    kind: wrap.kind,
    created_at: wrap.created_at,
    content: wrap.content,
    tags: wrap.tags,
    // `sig` deliberately dropped: signed by a throwaway ephemeral key that
    // nothing checks (CORD-01), so there is nothing here to preserve.
  }));
  return db.concordPendingWraps
    .bulkPut(rows)
    .then(() => true)
    .catch((error) => {
      console.warn("[concord] could not park wraps:", error);
      return false;
    });
}

/**
 * Read — WITHOUT removing — the wraps parked for these stream addresses.
 *
 * The caller decrypts them, writes the recovered rumors, and only then calls
 * {@link ackPendingWraps} with the ids that made it. Removing here would lose a
 * wrap whose store write failed, which is the same hazard the plane seen-memo
 * guards against.
 */
export async function peekPendingWraps(
  streamPks: string[],
): Promise<NostrEvent[]> {
  if (streamPks.length === 0) return [];
  if (pendingKnownEmpty === true) return [];
  try {
    if (pendingKnownEmpty === undefined) {
      const any = await db.concordPendingWraps.limit(1).toArray();
      // A concurrent park may have flipped this to `false` mid-probe; an empty
      // probe result must not clobber that.
      if (pendingKnownEmpty === undefined) pendingKnownEmpty = any.length === 0;
      if (pendingKnownEmpty === true) return [];
    }
    const now = Date.now();
    if (now - lastPendingPruneAt >= PENDING_PRUNE_INTERVAL_MS) {
      lastPendingPruneAt = now;
      const cutoff = Math.floor(now / 1000) - PENDING_MAX_AGE_SECS;
      void db.concordPendingWraps
        .where("created_at")
        .below(cutoff)
        .delete()
        .catch(() => undefined);
    }
    const rows = await db.concordPendingWraps
      .where("pubkey")
      .anyOf(streamPks)
      .toArray();
    // `sig` is empty by construction — see `parkPendingWraps`. `openWrap` never
    // reads it.
    return rows.map((row) => ({ ...row, sig: "" }) as NostrEvent);
  } catch {
    return [];
  }
}

/** Drop parked wraps whose rumors are now durably stored. */
export function ackPendingWraps(wrapIds: string[]): Promise<void> {
  if (wrapIds.length === 0) return Promise.resolve();
  return db.concordPendingWraps
    .bulkDelete(wrapIds)
    .then(() => undefined)
    .catch(() => undefined);
}

/** Test seam: forget the tri-state and the prune clock. */
export function _resetPendingWrapsForTests(): void {
  pendingKnownEmpty = undefined;
  lastPendingPruneAt = 0;
}
