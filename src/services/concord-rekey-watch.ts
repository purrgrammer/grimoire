/**
 * The rekey watch — CORD-06 §2, read and adopt only.
 *
 * Ported from armada `bc19d1f` (`src/concord/hooks/useRekey.ts`,
 * `useRekeyWatch` + `useChannelRekeyWatch`), with every mint, publish and
 * invite-refresh dropped: grimoire never rotates and never writes the Community
 * List. Adoption lands in `concord-adoptions.ts` instead.
 *
 * A POLL, not a wire subscription. Rotations are rare, admin-initiated, and
 * their addresses are per-epoch — a standing REQ would have to be rebuilt on
 * every adoption anyway, and armada polls, so this polls.
 *
 * Two halves, and their asymmetry is armada's, not an oversight:
 *
 *   BASE     watches `rootEpoch + 1` only. Authority is BAN (a Refounding).
 *   CHANNELS watch `epoch + 1 … epoch + 8` under EVERY held root. Authority is
 *            MANAGE_CHANNELS or BAN. The window exists because a member who
 *            MISSES a channel rotation is stranded otherwise: the channel moves
 *            on, the address they poll is never published again, and they hold
 *            a key that decrypts nothing while the room still sits in their
 *            sidebar. The base half has no such hole — a missed Refounding is
 *            recovered by a refreshed invite, not by the wire.
 *
 * A Refounding seals its channel rotations under the PRIOR root (CORD-06 §3),
 * so a member who adopted the base rotation first would derive the wrong
 * address from their fresh root alone. Hence every held root.
 */

import type { Filter, NostrEvent } from "nostr-tools";
import type { RelayPool } from "applesauce-relay";

import {
  baseRekeyGroupKey,
  bytesToHex,
  channelRekeyGroupKey,
  type GroupKey,
} from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import { citationSatisfied } from "@/lib/concord/control";
import { KIND_WRAP } from "@/lib/concord/kinds";
import { planeRequest } from "@/lib/concord/plane-request";
import {
  base64ToBytes,
  CHANNEL_REKEY_LOOKAHEAD,
  checkContinuity,
  decodeWrappedBaseKey,
  decodeWrappedKey,
  findBlob,
  groupRotations,
  lowerKeyWins,
  myLocator,
  parseRekey,
  ROOT_SCOPE_HEX,
  rotationExcludesMe,
  rotationPublishedAtMs,
  type ParsedRekey,
  type RekeyRotationSet,
} from "@/lib/concord/rekey";
import {
  hasPermission,
  outranksMember,
  Permissions,
} from "@/lib/concord/roles";
import { openWrap, type OpenedWireEvent } from "@/lib/concord/stream";
import { streamAuthsSettled } from "@/lib/concord/stream-auth";
import type { Community } from "@/lib/concord/types";
import { readAdoption, writeAdoption } from "@/services/concord-adoptions";
import { queryRekeyRounds, writeOpened } from "@/services/concord-rumor-store";
import db from "@/services/db";
import { whenAuthAnswered } from "@/lib/concord/plane-sync";

/** Per-request page size. Rotations are rare and small. */
const PAGE_LIMIT = 200;
const REQUEST_TIMEOUT_MS = 15_000;
const CURSOR_PREFIX = "rekey-cursor:";

/** What a signer must offer to open a blob — one ECDH, bunker-friendly. */
export interface PairwiseDecryptor {
  nip44?: { decrypt(pubkey: string, ciphertext: string): Promise<string> };
}

export interface RekeyWatchResult {
  /** A rotation handed us a new root or channel key; the caller should reload. */
  adopted: boolean;
  /**
   * A complete rotation published after we joined carried no blob for us: we
   * were kicked or banned. Being excluded is NOT leaving — the membership stays
   * on the list, marked read-only at that epoch.
   */
  excluded: boolean;
}

// ── Cursors ─────────────────────────────────────────────────────────────────
//
// PER RELAY, and that is the whole point (armada's issue-#19 family): a fast
// relay must never advance a shared cursor past a chunk a lagging relay still
// owes us. A permanently-skipped chunk leaves its rotation `!complete` forever,
// so the member never adopts and every message under the new epoch stays
// undecryptable — a silent, absorbing failure.

function cursorKey(scope: string, relayUrl: string): string {
  return `${CURSOR_PREFIX}${scope}|${relayUrl}`;
}

async function readCursor(
  scope: string,
  relayUrl: string,
): Promise<number | undefined> {
  try {
    const row = await db.concordKv.get(cursorKey(scope, relayUrl));
    const value = row?.value;
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Advance a relay's cursor, clamped to the local clock and monotone. */
async function advanceCursor(
  scope: string,
  relayUrl: string,
  createdAt: number,
): Promise<void> {
  const next = Math.min(createdAt, Math.floor(Date.now() / 1000));
  const prev = (await readCursor(scope, relayUrl)) ?? 0;
  if (next <= prev) return;
  try {
    await db.concordKv.put({ key: cursorKey(scope, relayUrl), value: next });
  } catch {
    // Best effort: a lost cursor costs one re-read, never a missed chunk.
  }
}

/** Test seam: forget every rekey cursor. */
export async function _resetRekeyCursorsForTests(): Promise<void> {
  await db.concordKv.where("key").startsWith(CURSOR_PREFIX).delete();
}

// ── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Fetch one rotation address set across every relay, decrypt what opens, and
 * store it.
 *
 * The cursor advances only once the rumors are DURABLY STORED. Armada advances
 * it and fire-and-forgets the write; here that is the one thing that cannot be
 * forgiven, because it is exactly the never-adopts failure the per-relay cursor
 * exists to prevent — a chunk dropped behind an advanced `since` is never
 * served again, and its rotation stays incomplete for good.
 */
async function fetchRounds(
  community: Community,
  scope: string,
  addresses: Map<string, GroupKey>,
  pool?: RelayPool,
): Promise<void> {
  const authors = [...addresses.keys()];
  if (authors.length === 0) return;

  await Promise.all(
    community.relays.map(async (url) => {
      const since = await readCursor(scope, url);
      const filter: Filter = {
        kinds: [KIND_WRAP],
        authors,
        limit: PAGE_LIMIT,
        ...(since ? { since } : {}),
      };
      const ask = () =>
        planeRequest(url, filter, { timeout: REQUEST_TIMEOUT_MS, pool });

      let read = await ask();
      const mine = (events: NostrEvent[]) =>
        events.filter((e) => e.kind === KIND_WRAP && addresses.has(e.pubkey));
      // The same two routine races the plane sweeps handle: a refused read
      // whose challenge has since been answered, and an empty page that raced
      // NIP-42 and reads back clean.
      if (
        read.outcome === "refused" ||
        (read.outcome === "eose" &&
          mine(read.events).length === 0 &&
          !streamAuthsSettled(url, authors))
      ) {
        await whenAuthAnswered(url, authors);
        read = await ask();
      }
      if (read.outcome !== "eose") return;

      const page = mine(read.events);
      if (page.length === 0) return;

      const opened: OpenedWireEvent[] = [];
      for (const wrap of page) {
        const address = addresses.get(wrap.pubkey);
        if (!address) continue;
        try {
          opened.push(openWrap(wrap, address));
        } catch {
          // not this address / malformed
        }
      }
      if (opened.length > 0) {
        const written = await writeOpened(community.idHex, opened, "rekey", {
          refounded: community.rootEpoch > 0n,
        });
        if (!written.ok) return; // cursor stays put — see the docstring
      }
      await advanceCursor(
        scope,
        url,
        Math.max(...page.map((e) => e.created_at)),
      );
    }),
  );
}

/** Parse the stored rounds for a set of targets. */
async function storedRotations(
  communityId: string,
  targets: Array<{ scopeIdHex: string; newEpoch: bigint }>,
): Promise<RekeyRotationSet[]> {
  const parsed: ParsedRekey[] = [];
  for (const opened of await queryRekeyRounds(communityId, targets)) {
    try {
      parsed.push(parseRekey(opened));
    } catch {
      // not a rekey / malformed
    }
  }
  return groupRotations(parsed);
}

// ── The base watch ──────────────────────────────────────────────────────────

/**
 * Watch the NEXT epoch's base-rekey address and react:
 *
 *   - a complete, authorized, continuity-checked rotation carrying OUR blob →
 *     adopt the new root, retaining the prior for history, and record the
 *     rotator as the new epoch's snapshot authority;
 *   - a complete rotation with NO blob for us across ALL chunks, published
 *     at/after we joined, by a rotator who strictly outranks us → we have been
 *     excluded. A missing chunk is never an exclusion, and neither is a
 *     rotation that predates our join: that is community history a stale invite
 *     dropped us onto.
 */
export async function watchBaseRekey(
  community: Community,
  folded: FoldedControl,
  viewer: { pubkey: string; signer: PairwiseDecryptor },
  joinedAtMs: number,
  opts: { pool?: RelayPool } = {},
): Promise<RekeyWatchResult> {
  const nip44 = viewer.signer.nip44;
  if (!nip44) return { adopted: false, excluded: false };

  const nextEpoch = community.rootEpoch + 1n;
  const address = baseRekeyGroupKey(community.root, community.id, nextEpoch);
  const scope = `base:${community.idHex}:${nextEpoch}`;
  await fetchRounds(
    community,
    scope,
    new Map([[address.pk, address]]),
    opts.pool,
  );

  const sets = await storedRotations(community.idHex, [
    { scopeIdHex: ROOT_SCOPE_HEX, newEpoch: nextEpoch },
  ]);

  // Authorized rotators only: a removed member still holding the prior root can
  // CONSTRUCT a perfect rotation, so authority is the roster, never key
  // possession (CORD-06 §Authority). A banned rotator is dropped outright —
  // every event from a banned npub is, authority actions included (CORD-04 §4).
  const rotations = sets.filter(
    (set) =>
      set.scopeIdHex === ROOT_SCOPE_HEX &&
      set.complete &&
      !folded.banned.has(set.rotator) &&
      (set.rotator === folded.ownerHex ||
        hasPermission(folded.roster, set.rotator, Permissions.BAN)) &&
      // CORD-04 §5: a rotation cites the Grant it acts under, so a lagging
      // client never honors a just-demoted admin's Refounding — the whole
      // community's keys turn on this one.
      citationSatisfied(folded, community.id, set.rotator, set.authority) &&
      checkContinuity(set, community.rootEpoch, community.root).ok,
  );
  if (rotations.length === 0) return { adopted: false, excluded: false };

  let adopted:
    | {
        key: Uint8Array;
        rotator: string;
        publishedAtMs: number;
        controlPk?: string;
        controlRoot?: Uint8Array;
      }
    | undefined;
  let sawExcludingRotation = false;

  for (const set of rotations) {
    // A rotation is our removal only if it could have carried our blob AND its
    // rotator strictly outranks us (CORD-06 §Authority: "the Rotator must
    // strictly outrank every removed target"). Other targets' locators are
    // opaque to us; our own removal is the one we can judge.
    const couldExcludeMe =
      rotationExcludesMe(rotationPublishedAtMs(set), joinedAtMs) &&
      outranksMember(
        folded.roster,
        set.rotator,
        folded.ownerHex,
        viewer.pubkey,
      );
    const blob = findBlob(
      set,
      myLocator(set.rotator, viewer.pubkey, set.scopeIdHex, set.newEpoch),
    );
    if (!blob) {
      if (couldExcludeMe) sawExcludingRotation = true;
      continue;
    }
    try {
      const plainB64 = await nip44.decrypt(set.rotator, blob.wrapped);
      const wrapped = decodeWrappedBaseKey(
        base64ToBytes(plainB64),
        community.id,
        set.newEpoch,
      );
      // Racing rotations converge on the lexicographically lowest new BASE key;
      // the control pair rides the winner's blobs, never compared (CORD-06 §3).
      if (
        !adopted ||
        lowerKeyWins(adopted.key, wrapped.newRoot) === wrapped.newRoot
      ) {
        adopted = {
          key: wrapped.newRoot,
          rotator: set.rotator,
          publishedAtMs: rotationPublishedAtMs(set),
          ...(wrapped.controlPk ? { controlPk: wrapped.controlPk } : {}),
          ...(wrapped.controlRoot ? { controlRoot: wrapped.controlRoot } : {}),
        };
      }
    } catch {
      // Undecryptable at our locator — treat as absent.
      if (couldExcludeMe) sawExcludingRotation = true;
    }
  }

  if (adopted) {
    const prior = await readAdoption(viewer.pubkey, community.idHex);
    const ok = await writeAdoption(viewer.pubkey, community.idHex, {
      roots: [
        ...(prior?.roots ?? []).filter((r) => BigInt(r.epoch) !== nextEpoch),
        {
          epoch: nextEpoch.toString(),
          key: bytesToHex(adopted.key),
          ...(adopted.controlPk ? { controlPk: adopted.controlPk } : {}),
          ...(adopted.controlRoot
            ? { controlRoot: bytesToHex(adopted.controlRoot) }
            : {}),
          refounder: adopted.rotator,
          // The root this rotation steps off is retired at the rotation's own
          // publish time — the hard cutoff past which nothing sealed under it
          // is read again.
          retiredAt: Math.floor(adopted.publishedAtMs / 1000),
        },
      ],
    });
    return { adopted: ok, excluded: false };
  }

  if (sawExcludingRotation) {
    const ok = await writeAdoption(viewer.pubkey, community.idHex, {
      excludedAtEpoch: nextEpoch.toString(),
    });
    return { adopted: false, excluded: ok };
  }
  return { adopted: false, excluded: false };
}

// ── The channel watch ───────────────────────────────────────────────────────

/**
 * Watch each held private channel's next-epoch rekey addresses and react per
 * channel, mirroring the base logic.
 *
 * ADOPTION requires an unbroken chain from the key we already hold: CORD-06 §2
 * makes `prevcommit` the proof that a rotation extends OUR key, and answers a
 * gap by fetching the missing link — never by waiving the check. Waiving it
 * lets one authorized rotator fork a lagging member onto a branch neither can
 * detect.
 *
 * REMOVAL is judged separately and needs no chain: hiding a channel is local
 * and errs safe, so a member whose gap can no longer be fetched still learns
 * the room moved on without them rather than sitting forever on a dead key.
 */
export async function watchChannelRekeys(
  community: Community,
  folded: FoldedControl,
  viewer: { pubkey: string; signer: PairwiseDecryptor },
  joinedAtMs: number,
  opts: { pool?: RelayPool } = {},
): Promise<RekeyWatchResult> {
  const nip44 = viewer.signer.nip44;
  if (!nip44 || community.privateChannels.length === 0) {
    return { adopted: false, excluded: false };
  }

  const roots =
    community.heldRoots.length > 0
      ? community.heldRoots
      : [{ epoch: community.rootEpoch, key: community.root }];
  const addresses = new Map<string, GroupKey>();
  for (const channel of community.privateChannels) {
    for (const root of roots) {
      for (let ahead = 1n; ahead <= BigInt(CHANNEL_REKEY_LOOKAHEAD); ahead++) {
        const address = channelRekeyGroupKey(
          root.key,
          channel.id,
          channel.epoch + ahead,
        );
        addresses.set(address.pk, address);
      }
    }
  }

  const watchKey = community.privateChannels
    .map((ch) => `${bytesToHex(ch.id)}:${ch.epoch + 1n}`)
    .sort()
    .join(",");
  await fetchRounds(
    community,
    `chan:${community.idHex}:${watchKey}`,
    addresses,
    opts.pool,
  );

  // Read back the SAME window the request covered. Reading only `held + 1`
  // would make the window a single-poll affair: the wire hands a rotation over
  // once, `since` advances past it, and the walk it was meant to complete then
  // sees a chain truncated at the first link on every later poll and every
  // restart — which is precisely the stranded member the window exists for.
  const sets = await storedRotations(
    community.idHex,
    community.privateChannels.flatMap((ch) =>
      Array.from({ length: CHANNEL_REKEY_LOOKAHEAD }, (_, i) => ({
        scopeIdHex: bytesToHex(ch.id),
        newEpoch: ch.epoch + BigInt(i + 1),
      })),
    ),
  );

  const prior = await readAdoption(viewer.pubkey, community.idHex);
  const channels = [...(prior?.channels ?? [])];
  const cuts = [...(prior?.cuts ?? [])];
  let changed = false;
  let excluded = false;

  for (const channel of community.privateChannels) {
    const chIdHex = bytesToHex(channel.id);
    // Authority for a channel rotation: MANAGE_CHANNELS mints a single-channel
    // rekey, BAN mints a Refounding's channel rotations, the owner outranks
    // all. Continuity is deliberately NOT filtered here — it gates ADOPTION
    // epoch by epoch as the chain is walked below.
    const rotations = sets
      .filter(
        (set) =>
          set.scopeIdHex === chIdHex &&
          set.newEpoch > channel.epoch &&
          set.complete &&
          !folded.banned.has(set.rotator) &&
          (set.rotator === folded.ownerHex ||
            hasPermission(folded.roster, set.rotator, Permissions.BAN) ||
            hasPermission(
              folded.roster,
              set.rotator,
              Permissions.MANAGE_CHANNELS,
            )) &&
          citationSatisfied(folded, community.id, set.rotator, set.authority),
      )
      .sort((a, b) =>
        a.newEpoch === b.newEpoch ? 0 : a.newEpoch < b.newEpoch ? -1 : 1,
      );
    if (rotations.length === 0) continue;

    const byEpoch = new Map<bigint, RekeyRotationSet[]>();
    for (const set of rotations) {
      const at = byEpoch.get(set.newEpoch);
      if (at) at.push(set);
      else byEpoch.set(set.newEpoch, [set]);
    }
    const ascending = [...byEpoch.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );

    let chainEpoch = channel.epoch;
    let chainKey = channel.key;
    let adopted: { key: Uint8Array; epoch: bigint } | undefined;
    let excludedAt: bigint | undefined; // ascending scan → the newest wins
    // Every key the walk steps OFF. Catching up across a gap opens each
    // intermediate epoch's key on the way past, and each one reads the history
    // written under it, so they are retained rather than thrown away with the
    // step. Each carries the superseding rotation's publish time as its cutoff.
    const steppedOver: Array<{
      key: Uint8Array;
      epoch: bigint;
      retiredAt?: number;
    }> = [];

    for (const epoch of ascending) {
      const candidates = byEpoch.get(epoch)!;
      let keyHere: Uint8Array | undefined;
      let publishedHereMs: number | undefined;
      let addressedHere = false;

      for (const set of candidates) {
        const blob = findBlob(
          set,
          myLocator(set.rotator, viewer.pubkey, chIdHex, epoch),
        );
        if (!blob) continue;
        addressedHere = true;
        // Only a rotation off the key we actually hold can hand us the next
        // one; a fork, or a gap we could not fetch, is not ours to adopt.
        if (!checkContinuity(set, chainEpoch, chainKey).ok) continue;
        try {
          const plainB64 = await nip44.decrypt(set.rotator, blob.wrapped);
          // Scope binds INSIDE the ciphertext: a blob minted for another
          // channel (or for the base) can never be spliced onto this one.
          const newKey = decodeWrappedKey(
            base64ToBytes(plainB64),
            channel.id,
            epoch,
          );
          keyHere = keyHere ? lowerKeyWins(keyHere, newKey) : newKey;
          // Retirement is the EARLIEST honored rotation at this epoch — the
          // moment the channel verifiably moved on.
          const at = rotationPublishedAtMs(set);
          publishedHereMs =
            publishedHereMs === undefined ? at : Math.min(publishedHereMs, at);
        } catch {
          // Undecryptable at our locator — not a key we can carry forward.
        }
      }

      if (keyHere) {
        steppedOver.unshift({
          key: chainKey,
          epoch: chainEpoch,
          ...(publishedHereMs !== undefined
            ? { retiredAt: Math.floor(publishedHereMs / 1000) }
            : {}),
        });
        adopted = { key: keyHere, epoch };
        chainEpoch = epoch;
        chainKey = keyHere;
        continue;
      }
      // Addressed to us, but not off a key we can verify: neither adopt nor
      // remove. The window keeps polling, so if the missing link shows up the
      // chain completes; acting either way on an unproven rotation is how a
      // member ends up on a fork or loses a room they still hold.
      if (addressedHere) continue;
      // Nothing here for us at all. If a rotation at this epoch could have
      // carried our blob and did not, that is the read-cut — but only from a
      // rotator who STRICTLY OUTRANKS us. A peer's rotation is no more our
      // removal than a forged one.
      if (
        candidates.some(
          (set) =>
            rotationExcludesMe(rotationPublishedAtMs(set), joinedAtMs) &&
            outranksMember(
              folded.roster,
              set.rotator,
              folded.ownerHex,
              viewer.pubkey,
            ),
        )
      ) {
        excludedAt = epoch;
      }
    }

    // A key addressed to us ABOVE the newest rotation that skipped us is a
    // re-admission; below it, the exclusion is the later word.
    if (adopted && (excludedAt === undefined || adopted.epoch > excludedAt)) {
      const at = channels.findIndex((c) => c.idHex === chIdHex);
      const entry = {
        idHex: chIdHex,
        epoch: adopted.epoch.toString(),
        key: bytesToHex(adopted.key),
        priors: [
          ...steppedOver.map((p) => ({
            epoch: p.epoch.toString(),
            key: bytesToHex(p.key),
            ...(p.retiredAt !== undefined ? { retiredAt: p.retiredAt } : {}),
          })),
          ...(at >= 0 ? (channels[at].priors ?? []) : []),
        ],
      };
      if (at >= 0) channels[at] = entry;
      else channels.push(entry);
      changed = true;
    } else if (excludedAt !== undefined) {
      // Removed from this channel: it is dropped so it visibly disappears
      // (CORD-06 §2). The cut is RECORDED at the epoch that excluded us, so a
      // stale invite bundle carrying the pre-rotation key can never merge the
      // access back.
      const at = cuts.findIndex((c) => c.idHex === chIdHex);
      const entry = { idHex: chIdHex, epoch: excludedAt.toString() };
      if (at >= 0) cuts[at] = entry;
      else cuts.push(entry);
      changed = true;
      excluded = true;
    }
  }

  if (!changed) return { adopted: false, excluded: false };
  const ok = await writeAdoption(viewer.pubkey, community.idHex, {
    channels,
    cuts,
  });
  return { adopted: ok && !excluded, excluded: ok && excluded };
}

/**
 * One round of both watches.
 *
 * The base runs FIRST: a Refounding rolls the root, and the channel addresses
 * derive from every held root — so adopting the base before walking the
 * channels means the very next round already watches under the fresh root as
 * well as the prior one.
 */
export async function watchRekeys(
  community: Community,
  folded: FoldedControl,
  viewer: { pubkey: string; signer: PairwiseDecryptor },
  joinedAtMs: number,
  opts: { pool?: RelayPool } = {},
): Promise<RekeyWatchResult> {
  const base = await watchBaseRekey(
    community,
    folded,
    viewer,
    joinedAtMs,
    opts,
  ).catch((error: unknown) => {
    console.debug("[concord] base rekey watch failed:", error);
    return { adopted: false, excluded: false };
  });
  const channels = await watchChannelRekeys(
    community,
    folded,
    viewer,
    joinedAtMs,
    opts,
  ).catch((error: unknown) => {
    console.debug("[concord] channel rekey watch failed:", error);
    return { adopted: false, excluded: false };
  });
  return {
    adopted: base.adopted || channels.adopted,
    excluded: base.excluded || channels.excluded,
  };
}
