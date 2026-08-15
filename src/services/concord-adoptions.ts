/**
 * Locally-adopted rotation keys, and how they layer over the Community List.
 *
 * Armada writes an adoption straight into the member's own kind-13302 list.
 * Grimoire never publishes that document (see the port's key-custody rule), so
 * an adoption lands in Dexie instead and this module is the seam that makes the
 * two agree.
 *
 * THE RULE: the list is the source of truth, the adoption is a cache allowed to
 * run ahead of it. Concretely, per community:
 *
 *   - adoption epoch  >  list epoch  → the adoption leads; layer it on;
 *   - adoption epoch  <  list epoch  → armada published it; the adoption is
 *     spent, and is DELETED rather than left to shadow a newer list forever;
 *   - adoption epoch  == list epoch, same key → same fact from two directions;
 *     delete;
 *   - adoption epoch  == list epoch, DIFFERENT key → a same-epoch race
 *     (CORD-06 §3). Converge on the lexicographically lower key and keep both
 *     held, so messages sent into the losing fork stay readable.
 */

import { bytesToHex, hexToBytes } from "@/lib/concord/derive";
import type { Community, HeldRoot } from "@/lib/concord/types";
import db, { type ConcordAdoptionRow } from "@/services/db";

/** One community's adoptions, or undefined. */
export async function readAdoption(
  pubkey: string,
  idHex: string,
): Promise<ConcordAdoptionRow | undefined> {
  if (!pubkey || !idHex) return undefined;
  try {
    return await db.concordAdoptions.get([pubkey, idHex]);
  } catch {
    return undefined;
  }
}

/** Every adoption this account holds, by community id. */
export async function readAdoptions(
  pubkey: string,
): Promise<Map<string, ConcordAdoptionRow>> {
  const out = new Map<string, ConcordAdoptionRow>();
  if (!pubkey) return out;
  try {
    const rows = await db.concordAdoptions
      .where("pubkey")
      .equals(pubkey)
      .toArray();
    for (const row of rows) out.set(row.idHex, row);
  } catch {
    // A read failure is a cold cache, never an error worth failing a read for.
  }
  return out;
}

/** Merge a patch into one community's adoption row. */
export async function writeAdoption(
  pubkey: string,
  idHex: string,
  patch: Partial<Omit<ConcordAdoptionRow, "pubkey" | "idHex" | "updatedAt">>,
): Promise<boolean> {
  if (!pubkey || !idHex) return false;
  try {
    await db.transaction("rw", db.concordAdoptions, async () => {
      const prior = await db.concordAdoptions.get([pubkey, idHex]);
      await db.concordAdoptions.put({
        pubkey,
        idHex,
        roots: patch.roots ?? prior?.roots ?? [],
        channels: patch.channels ?? prior?.channels ?? [],
        cuts: patch.cuts ?? prior?.cuts ?? [],
        ...((patch.excludedAtEpoch ?? prior?.excludedAtEpoch)
          ? { excludedAtEpoch: patch.excludedAtEpoch ?? prior?.excludedAtEpoch }
          : {}),
        updatedAt: Date.now(),
      });
    });
    return true;
  } catch (error) {
    console.warn("[concord] adoption write failed:", error);
    return false;
  }
}

/** Forget one account's adoptions (account removal, or a spent row). */
export async function clearAdoptions(
  pubkey: string,
  idHex?: string,
): Promise<void> {
  try {
    if (idHex) await db.concordAdoptions.delete([pubkey, idHex]);
    else await db.concordAdoptions.where("pubkey").equals(pubkey).delete();
  } catch {
    // Best effort.
  }
}

// ── The merge ────────────────────────────────────────────────────────────────

const lowerHex = (hex: string) => hex.toLowerCase();

/** Is a stored 32-byte hex key usable? A corrupt row must never become a key. */
const key32 = (hex: string): Uint8Array | undefined =>
  /^[0-9a-f]{64}$/i.test(hex) ? hexToBytes(lowerHex(hex)) : undefined;

/**
 * Layer one community's adoptions over its rehydrated list entry.
 *
 * Returns the community to use, and whether the adoption row is SPENT (the list
 * has caught up, so the row should be deleted). Pure — the caller does the
 * delete, so a read path can stay read-only if it wants to.
 */
export function applyAdoption(
  community: Community,
  row: ConcordAdoptionRow | undefined,
): { community: Community; spent: boolean } {
  if (!row) return { community, spent: false };

  let out = community;
  let spent = true;

  // ── Roots ──
  // Ascending, so a client that adopted several epochs while offline walks them
  // in order and each one retires the epoch below it.
  const roots = [...row.roots].sort((a, b) =>
    BigInt(a.epoch) < BigInt(b.epoch)
      ? -1
      : BigInt(a.epoch) > BigInt(b.epoch)
        ? 1
        : 0,
  );
  for (const adopted of roots) {
    const epoch = BigInt(adopted.epoch);
    const key = key32(adopted.key);
    if (!key) continue;

    if (epoch < out.rootEpoch) continue; // history; the list already leads
    if (epoch === out.rootEpoch) {
      // Same epoch. Either the list caught up with exactly this key, or two
      // rotators raced it — in which case CORD-06 §3 converges DOWN, and both
      // keys stay held so the losing fork's messages stay readable.
      const held = bytesToHex(out.root);
      if (held === bytesToHex(key)) continue;
      const listWins = held <= bytesToHex(key);

      // THE CONTROL PAIR TRAVELS WITH ITS OWN ROOT, and only the winner's is
      // this epoch's. The pair is minted beside the root it ships with
      // (CORD-06 §1), so pinning the loser's `control_pk` onto the winning
      // `HeldRoot` would make this client register and sweep the losing fork's
      // Control Plane and never the winner's — no roster, no banlist, no
      // channel updates — and `refounder` is the epoch's snapshot authority, so
      // real snapshots would be refused too. The list's own entry for this
      // epoch is therefore KEPT when the list wins, rather than rebuilt from
      // the adoption's fields.
      const listHeld = out.heldRoots.find((r) => r.epoch === epoch);
      const winnerHeld: HeldRoot = listWins
        ? (listHeld ?? { epoch, key: out.root })
        : heldOf(epoch, key, adopted);
      const loserHeld: HeldRoot = listWins
        ? { epoch, key }
        : (listHeld ?? { epoch, key: out.root });

      out = {
        ...out,
        root: listWins ? out.root : key,
        ...(listWins
          ? {}
          : {
              controlPk: adopted.controlPk,
              controlRoot: adopted.controlRoot
                ? key32(adopted.controlRoot)
                : undefined,
              refounder: adopted.refounder,
            }),
        heldRoots: [
          winnerHeld,
          loserHeld,
          ...out.heldRoots.filter((r) => r.epoch !== epoch),
        ],
      };
      spent = false;
      continue;
    }

    // The adoption leads. The root it steps off is retired at the rotation's
    // own publish time — the hard cutoff past which nothing sealed under it is
    // read again (see `HeldRoot.retiredAt`).
    spent = false;
    const priorEpoch = out.rootEpoch;
    out = {
      ...out,
      root: key,
      rootEpoch: epoch,
      // The control pair is the BLOB's, never inherited: the secret rolls with
      // the root at every Refounding (CORD-02 §2), so carrying a stale pair
      // forward would subscribe at a dead address. A legacy 72-byte blob leaves
      // both unset, and that epoch's Control folds at the legacy address.
      controlPk: adopted.controlPk,
      controlRoot: adopted.controlRoot ? key32(adopted.controlRoot) : undefined,
      refounder: adopted.refounder,
      heldRoots: [
        heldOf(epoch, key, adopted),
        ...out.heldRoots.map((r) =>
          r.epoch === priorEpoch && r.retiredAt === undefined
            ? { ...r, retiredAt: adopted.retiredAt }
            : r,
        ),
      ],
    };
  }

  // ── Private channels ──
  const byId = new Map(row.channels.map((c) => [lowerHex(c.idHex), c]));
  const cuts = new Map(
    row.cuts.map((c) => [lowerHex(c.idHex), BigInt(c.epoch)]),
  );
  if (byId.size > 0 || cuts.size > 0) {
    const channels = [];
    for (const held of out.privateChannels) {
      const idHex = bytesToHex(held.id);
      const cut = cuts.get(idHex);
      // A cut is recorded at the epoch that excluded us. It only applies to the
      // generation we hold: a re-admission at a later epoch arrives as an
      // adoption above the cut, and must not be filtered back out by it.
      if (cut !== undefined && cut > held.epoch) {
        spent = false;
        continue;
      }
      const adopted = byId.get(idHex);
      const key = adopted ? key32(adopted.key) : undefined;
      if (!adopted || !key || BigInt(adopted.epoch) <= held.epoch) {
        channels.push(held);
        continue;
      }
      spent = false;
      channels.push({
        ...held,
        key,
        epoch: BigInt(adopted.epoch),
        // Every key the walk stepped off is retained: each reads what was
        // written under it, so dropping them would trade a rotation for a hole
        // in the conversation.
        priors: [
          ...(adopted.priors ?? []).flatMap((p) => {
            const pk = key32(p.key);
            return pk
              ? [{ key: pk, epoch: BigInt(p.epoch), retiredAt: p.retiredAt }]
              : [];
          }),
          ...(held.priors ?? []),
        ],
      });
    }
    out = { ...out, privateChannels: channels };
  }

  // ── What can never be "spent" ──
  //
  // `spent` means the LIST HAS CAUGHT UP, so the cached copy can go. Two kinds
  // of record are not caches of anything the list will ever carry, and deleting
  // them loses the fact outright:
  //
  //   - `cuts` are a FLOOR. The cut exists so a stale invite bundle carrying the
  //     pre-rotation key can never merge the access back; drop it and the next
  //     list read re-admits the member to a channel they were removed from. It
  //     stays even when the channel it names is no longer vended — that is
  //     precisely the state it is describing.
  //   - `excludedAtEpoch` is the base watcher's only output when a Refounding
  //     cut us. Nothing else records it, and it computed spent on a row with no
  //     roots and no channels — so it was written and deleted on alternate
  //     passes, forever, and could never be read by anything.
  if (row.cuts.length > 0 || row.excludedAtEpoch !== undefined) spent = false;

  return { community: out, spent };
}

function heldOf(
  epoch: bigint,
  key: Uint8Array,
  adopted: ConcordAdoptionRow["roots"][number],
): HeldRoot {
  // The rotator is this epoch's snapshot authority (CORD-02 §5), recorded per
  // root so it survives later rotations — `snapshotAuthorities` reads it.
  return {
    epoch,
    key,
    ...(adopted.controlPk ? { controlPk: adopted.controlPk } : {}),
    ...(adopted.refounder ? { refounder: adopted.refounder } : {}),
  };
}
