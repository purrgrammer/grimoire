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

import type { FoldedControl } from "@/lib/concord/control";
import { isExpired } from "@/lib/concord/disappearing";
import { PLANE_KINDS, PLANE_RULES, type Plane } from "@/lib/concord/kinds";
import type { OpenedEvent, OpenedWireEvent } from "@/lib/concord/stream";
import { resolveMs } from "@/lib/concord/stream";
import db, { type ConcordRumorRow } from "@/services/db";

/** The chat plane's channel binding (CORD-03 §3) — the tag chat reads index. */
const TAG_CHANNEL = "channel";

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
): Promise<boolean> {
  const rule = PLANE_RULES[plane];
  const allowed = opened.filter(
    (o) =>
      rule.kinds.includes(o.kind) &&
      o.sealKind === rule.sealKind &&
      !o.tags.some((t) => t[0] === TAG_CHANNEL),
  );
  if (allowed.length === 0 || !communityId) return true;
  try {
    await db.concordRumors.bulkPut(allowed.map((o) => toRow(communityId, o)));
    if (plane === "control" && (opts.refounded ?? true)) {
      await noteControlSnapshot(communityId, allowed);
    }
    return true;
  } catch (error) {
    console.warn("[concord] plane write failed:", error);
    return false;
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
  opened: Array<OpenedEvent & { channel: string }>,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  // Already-expired rumors are refused at ingest (CORD-08 §3). Storing one only
  // hands the read filter something to hide and the local sweep something to
  // delete — and in the meantime it sits in Dexie as plaintext at rest, which is
  // exactly what the sender asked would not happen.
  const allowed = opened.filter(
    (o) => !PLANE_KINDS.has(o.kind) && !isExpired(o.tags, nowSecs),
  );
  if (allowed.length === 0 || !communityId) return true;
  try {
    await db.concordRumors.bulkPut(
      allowed.map((o) => toRow(communityId, o, o.channel.toLowerCase())),
    );
    return true;
  } catch (error) {
    console.warn("[concord] chat write failed:", error);
    return false;
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
