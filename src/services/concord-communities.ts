/**
 * The Concord membership vault — read side.
 *
 * The viewer's kind-13302 Community List (CORD-02 §8) is the ONLY durable
 * record of Concord membership: it holds each community's `community_root` and
 * private-channel keys, NIP-44-encrypted to self. Armada owns the document;
 * grimoire fetches it, decrypts it, and mirrors the live entries into Dexie so
 * the rest of the client can enumerate communities without a signer round-trip.
 *
 * Nothing here publishes. See `src/lib/concord/community-list.ts` for why there
 * is no serializer at all.
 *
 * The read disciplines below are ported from armada `bc19d1f`
 * (`src/concord/hooks/useCommunityList.ts`), minus its merge and its stock-relay
 * fallback (see `fetchListEvent`).
 */

import { KIND_COMMUNITY_LIST } from "@/lib/concord/kinds";
import {
  liveEntries,
  parseCommunityList,
  rehydrateCommunity,
  type CommunityList,
  type CommunityListEntry,
} from "@/lib/concord/community-list";
import { heldControlPlanes } from "@/lib/concord/control-address";
import { clearGroupKeyMemo } from "@/lib/concord/derive";
import { resetAnnouncedMemory } from "@/lib/concord/notify";
import { resetPlaneSweepMemory } from "@/lib/concord/plane-sync";
import {
  clearGroupKeyPersistence,
  initGroupKeyPersistence,
} from "@/lib/concord/group-key-persist";
import { registerStreamKeys } from "@/lib/concord/stream-auth";
import type { Community } from "@/lib/concord/types";
import { requestEvents } from "@/lib/relay-subscription";
import {
  applyAdoption,
  clearAdoptions,
  readAdoptions,
} from "@/services/concord-adoptions";
import { invalidateChannelDirectory } from "@/services/concord-channel-directory";
import { resetNotifPrefsMemory } from "@/services/concord-notif-prefs";
import { resetConcordPrefs } from "@/services/concord-prefs";
import { resetDraftCache } from "@/services/chat-drafts";
import { clearReads } from "@/services/concord-reads";
import db, { type ConcordCommunityRow } from "@/services/db";
import eventStore from "@/services/event-store";
import { startConcordStreamAuth } from "@/services/concord-stream-auth";
import { resetDissolutionMemory } from "@/services/concord-dissolution";
import { selectRelaysForFilter } from "@/services/relay-selection";
import type { NostrEvent } from "@/types/nostr";

/** The only signer capability this module needs. */
export interface Nip44Decryptor {
  nip44?: { decrypt(pubkey: string, ciphertext: string): Promise<string> };
}

export type ConcordListStatus =
  /** The list was read (or is genuinely absent) and the vault reflects it. */
  | "ok"
  /** No signer, or one without NIP-44 — the vault is whatever was last stored. */
  | "no-decryptor"
  /** A list exists but would not decrypt; the stored vault was left untouched. */
  | "decrypt-failed";

export interface ConcordListResult {
  status: ConcordListStatus;
  communities: Community[];
}

/**
 * Decode-once memo, keyed by list event id. The document is a few KB of NIP-44
 * and a remote signer round-trip can cost seconds, so re-decrypting an event we
 * have already read is the one cost worth never paying twice.
 */
const decryptMemo = new Map<string, Promise<CommunityList | undefined>>();

/**
 * Fetch the newest kind-13302 for `pubkey` from their outbox relays.
 *
 * Armada additionally falls back to a hardcoded set of stock Concord relays,
 * because a user whose own relays refuse kind 13302 has a vault that lives
 * ONLY there. Grimoire does not hardcode relays, so a list in that position is
 * invisible here — the community simply does not appear.
 */
async function fetchListEvent(pubkey: string): Promise<NostrEvent | null> {
  const filter = {
    kinds: [KIND_COMMUNITY_LIST],
    authors: [pubkey],
    limit: 1,
  };
  const { relays } = await selectRelaysForFilter(eventStore, filter);
  const events = await requestEvents(relays, [filter]);
  // Replaceables tie-break on the lowest id at equal created_at, but a relay
  // may serve an older copy alongside a newer one, so pick explicitly.
  return events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

async function decryptList(
  event: NostrEvent,
  signer: Nip44Decryptor,
  pubkey: string,
): Promise<CommunityList | undefined> {
  const cached = decryptMemo.get(event.id);
  if (cached) return cached;

  const nip44 = signer.nip44;
  if (!nip44) return undefined;
  const work = (async () => {
    try {
      return parseCommunityList(await nip44.decrypt(pubkey, event.content));
    } catch (error) {
      console.warn("[concord] could not decrypt the community list:", error);
      // Let a later call retry a transient signer failure.
      decryptMemo.delete(event.id);
      return undefined;
    }
  })();
  decryptMemo.set(event.id, work);
  return work;
}

/** Which 13302 the mirror currently reflects. Survives an empty vault. */
interface VaultState {
  eventId: string;
  createdAt: number;
}

const vaultStateKey = (pubkey: string) => `concordListState:${pubkey}`;

/**
 * Whether `event` may replace what the mirror already reflects.
 *
 * Armada gets this for free from its merge — "a transient short relay read
 * can't drop rooms". Grimoire has no merge, so the same protection has to come
 * from monotonicity instead: a relay lagging behind on a replaceable will serve
 * a genuine, decryptable, older 13302, and taking it would delete the rows for
 * every community joined since — keys and all — until a fresh relay answers.
 * That is the wrongful-empty failure by a different route.
 *
 * The state is kept beside the rows rather than on them, so the floor still
 * exists for a viewer whose list is legitimately empty.
 */
async function mayReplace(pubkey: string, event: NostrEvent): Promise<boolean> {
  const row = await db.concordKv.get(vaultStateKey(pubkey));
  const prev = row?.value as VaultState | undefined;
  if (!prev) return true;
  if (prev.eventId === event.id) return false; // already mirrored
  return event.created_at >= prev.createdAt;
}

/**
 * Replace this viewer's mirrored memberships with exactly `entries`.
 *
 * One transaction, delete-then-put: a community the user left must disappear,
 * and a partial write would leave the vault claiming a membership the list no
 * longer carries. Tombstones are not stored — liveness is resolved here, at
 * decrypt time, and only live entries are mirrored.
 */
async function replaceVault(
  pubkey: string,
  entries: CommunityListEntry[],
  event: NostrEvent,
): Promise<void> {
  const now = Date.now();
  const rows: ConcordCommunityRow[] = entries.map((entry) => ({
    pubkey,
    idHex: entry.community_id.toLowerCase(),
    entry,
    name: typeof entry.current?.name === "string" ? entry.current.name : "",
    listEventId: event.id,
    listCreatedAt: event.created_at,
    updatedAt: now,
  }));
  await db.transaction("rw", db.concordCommunities, db.concordKv, async () => {
    await db.concordCommunities.where("pubkey").equals(pubkey).delete();
    if (rows.length > 0) await db.concordCommunities.bulkPut(rows);
    await db.concordKv.put({
      key: vaultStateKey(pubkey),
      value: { eventId: event.id, createdAt: event.created_at } as VaultState,
    });
  });
}

/**
 * Read the viewer's memberships out of Dexie, rehydrated.
 *
 * Works with no signer and no network — that is the point of mirroring. A row
 * whose owner commitment does not verify is dropped rather than surfaced
 * (`rehydrateCommunity` fails closed).
 */
export async function loadStoredCommunities(
  pubkey: string,
): Promise<Community[]> {
  const [rows, adoptions] = await Promise.all([
    db.concordCommunities.where("pubkey").equals(pubkey).toArray(),
    readAdoptions(pubkey),
  ]);
  const out: Community[] = [];
  const spent: string[] = [];
  for (const row of rows) {
    const rehydrated = rehydrateCommunity(row.entry as CommunityListEntry);
    if (!rehydrated) continue;
    // Layer on anything this device adopted from a rotation the list has not
    // caught up with yet. A row the list HAS caught up with is spent — dropped
    // here rather than left to shadow a newer list forever.
    const { community, spent: done } = applyAdoption(
      rehydrated,
      adoptions.get(rehydrated.idHex),
    );
    if (done && adoptions.has(rehydrated.idHex)) spent.push(rehydrated.idHex);
    out.push(community);
  }
  for (const idHex of spent) void clearAdoptions(pubkey, idHex);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * When this viewer joined a community, in epoch-ms (the list entry's
 * `added_at`), or UNDEFINED when it cannot be established.
 *
 * The removal decision needs it: a complete rotation carrying no blob for us is
 * an exclusion only if it published AT OR AFTER we joined. One that predates the
 * join is community history a stale invite dropped us onto, and reading it as a
 * removal would eject every fresh joiner seconds after they arrive.
 *
 * **NOT ZERO ON FAILURE.** A join time of 0 makes every rotation in history
 * postdate the join, which turns that guard off entirely — the one guard whose
 * absence costs a member their channels. A missing row, a non-numeric
 * `added_at` (the list parser tolerates anything) or a Dexie failure are all
 * "we do not know", and armada's answer to not knowing is to not act at all
 * (`if (!entry) return; // the removal decision needs my join time`). So this
 * returns undefined and the caller declines to run.
 */
export async function readJoinedAtMs(
  pubkey: string,
  idHex: string,
): Promise<number | undefined> {
  try {
    const row = await db.concordCommunities.get([pubkey, idHex]);
    if (!row) return undefined;
    const addedAt = (row.entry as CommunityListEntry | undefined)?.added_at;
    return typeof addedAt === "number" && Number.isFinite(addedAt)
      ? addedAt
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch, decrypt and mirror the viewer's Community List, then return the
 * memberships.
 *
 * Fails soft in both directions that matter. Without a NIP-44 signer (a
 * read-only account, or a remote signer still connecting) the stored vault is
 * returned as-is rather than throwing — the communities must not blank while a
 * signer wakes up. And a list that will not decrypt NEVER clears the vault: the
 * keys live in that document, so a wrongful empty would look exactly like
 * leaving every community at once.
 */
export async function syncCommunities(
  pubkey: string,
  signer: Nip44Decryptor | undefined,
): Promise<ConcordListResult> {
  // The first Concord read is where the derivation cache is worth hydrating:
  // everything downstream of a membership derives stream keys from it.
  await initGroupKeyPersistence();

  const stored = await loadStoredCommunities(pubkey);
  // Register before the fetch, not after: the vault may already hold every
  // community, and the stream keys have to be in the registry before anything
  // sweeps a plane.
  registerControlAddresses(stored);
  if (!signer?.nip44) return { status: "no-decryptor", communities: stored };

  const event = await fetchListEvent(pubkey);
  if (!event) {
    // No list on any relay we asked. That is not proof there is none (the
    // relays may simply not carry it), so the vault stands.
    return { status: "ok", communities: stored };
  }

  // Checked before the decrypt so a lagging relay costs no signer round-trip.
  if (!(await mayReplace(pubkey, event))) {
    return { status: "ok", communities: stored };
  }

  const list = await decryptList(event, signer, pubkey);
  if (!list) return { status: "decrypt-failed", communities: stored };

  const live = liveEntries(list);
  await replaceVault(pubkey, live, event);
  const communities = await loadStoredCommunities(pubkey);
  registerControlAddresses(communities);
  return { status: "ok", communities };
}

/**
 * Register every held epoch's Control Plane address for NIP-42, scoped to the
 * community's own relays, and start the socket-lifecycle wiring.
 *
 * EVERY held epoch, not just the current one: an address missing from the
 * registry reports "not yet registered" to the auth gate rather than "accounted
 * for", which blocks a sweep instead of letting it proceed. A SPLIT epoch
 * registers ADDRESS-ONLY — its signing secret derives from a `control_root`
 * only staff hold (CORD-02 §2) — so on a gating relay that plane is simply
 * unreadable, and reporting that beats waiting forever for an ack that cannot
 * come.
 */
export function registerControlAddresses(communities: Community[]): void {
  startConcordStreamAuth();
  for (const community of communities) {
    if (community.relays.length === 0) continue;
    const keys = heldControlPlanes(community).map((plane) => ({
      pk: plane.group.pk,
      ...(plane.canAuthenticate && plane.group.sk
        ? { sk: plane.group.sk }
        : {}),
    }));
    registerStreamKeys(keys, community.relays);
  }
}

/**
 * Wipe one account's Concord state on logout: the mirrored memberships, the
 * decrypted message bodies, and every derivation cache and cursor.
 *
 * **The keys are not the sensitive half.** The vault rows hold decrypted
 * `community_root`s and channel keys, so they obviously go — but
 * `concordRumors` holds the PLAINTEXT of every message ever read: who wrote it,
 * when, and what it said. Clearing the keys and leaving those behind protects
 * nothing, because nothing has to be decrypted a second time. Someone logging
 * out to take a community off a machine means the conversations too.
 *
 * The rumor store, snapshots and `concordKv` are all keyed by COMMUNITY, not by
 * account, so there is no account-scoped delete to issue against them. This
 * wipes them whole. That is correct while grimoire is single-account, and it is
 * the reason a second account would need those tables scoped BEFORE it shipped
 * — otherwise one logout takes the other account's history with it.
 */
export async function clearCommunities(pubkey: string): Promise<void> {
  // allSettled, NOT all, and NOT sequential awaits: a rejection anywhere in a
  // `Promise.all` — or a throw from an earlier `await` — abandons every wipe
  // after it, which on a wipe is precisely backwards. One table erroring would
  // silently leave the rest full. Every table gets its attempt, and whatever
  // failed is reported rather than swallowed.
  const wipes = await Promise.allSettled([
    db.concordCommunities.where("pubkey").equals(pubkey).delete(),
    // Adoptions hold decrypted roots and channel keys of their own — leaving
    // them behind would keep this account's key material after the vault is
    // gone.
    clearAdoptions(pubkey),
    // Decrypted rumors, control snapshots, parked wraps, and every cursor,
    // fold, seen-memo, dissolution verdict and notification level in
    // `concordKv`. The table is emptied WHOLE and is treated as Concord-owned,
    // which the notification levels now qualify rather than contradict: their
    // keys carry a protocol so a NIP-29 container cannot collide with a
    // community, but the rows still live here and a Concord logout still takes
    // them. A family that must outlive one needs its own table, not a
    // different key.
    db.concordRumors.clear(),
    db.concordSnapshots.clear(),
    db.concordPendingWraps.clear(),
    db.concordKv.clear(),
    // Read state is account-scoped, so unlike the rest of these it can be
    // deleted for the account that left and nobody else. It says which channels
    // this person was reading and when they last looked.
    clearReads(pubkey),
    // Queued sends and half-typed drafts are the most plainly personal rows
    // here: prose this account WROTE, that no relay has even seen. Both are
    // account-scoped — the outbox by column, the drafts by key prefix, since
    // the account is the first segment of a draft's key. Written out here
    // rather than called through their own services, which would import this
    // module back and close a cycle around the community loader.
    db.concordOutbox.where("pubkey").equals(pubkey).delete(),
    db.chatDrafts.where("key").startsWith(`${pubkey}:`).delete(),
  ]);
  const failed = wipes.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(
      "[concord] some tables survived the logout wipe:",
      failed.map((r) => r.reason),
    );
  }
  // In-memory, and outliving the tables otherwise: the derivation memo holds
  // stream secrets, and the sweep memos hold wrap ids from the account that
  // just left.
  clearGroupKeyMemo();
  resetPlaneSweepMemory();
  resetDissolutionMemory();
  clearDecryptMemo();
  // The channel directory holds decrypted community and channel NAMES, which
  // would otherwise outlive the fold they were read from.
  invalidateChannelDirectory();
  // Notification levels live in `concordKv`, which the wipe above emptied — so
  // the memo in front of it has to go too, or the tab keeps answering with
  // levels that no longer exist and hands them to whoever signs in next.
  resetNotifPrefsMemory();
  // Pins, folded categories and the channel each community was left on. These
  // live in localStorage rather than `concordKv`, so the table wipe above does
  // not reach them — and they must go for the same reason the levels do: they
  // name the communities and channels this account cared enough to arrange.
  resetConcordPrefs();
  // The ids of every message this tab has already announced. Opaque and
  // bounded, so nothing leaks — but it is the account's traffic, and the memo
  // block is where the account's traces go.
  resetAnnouncedMemory();
  // Drafts are cached in memory to answer a render synchronously, so the rows
  // going is not enough — the tab would keep handing them to the next account.
  resetDraftCache();
  await clearGroupKeyPersistence();
}

/**
 * Forget which list events have already been decrypted.
 *
 * The memo caches decrypted Community Lists by event id, so it holds the
 * account's memberships in memory after their rows are gone.
 */
export function clearDecryptMemo(): void {
  decryptMemo.clear();
}

/** Test seam: {@link clearDecryptMemo}. */
export function _resetDecryptMemoForTests(): void {
  clearDecryptMemo();
}
