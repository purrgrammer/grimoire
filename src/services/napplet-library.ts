/**
 * The napplets a user has run, so they can be found again.
 *
 * Deliberately local. NIP-51 defines no kind for a napplet list and neither
 * does NIP-5D, so publishing one would be inventing a wire format. Everything
 * here goes through this module rather than touching Dexie directly, so
 * swapping the backing store for a specced kind later is a migration rather
 * than a rewrite.
 */

import db, { type InstalledNapplet } from "./db";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";

/** The stable identity of a launcher entry. */
export function nappletCoordinate(
  pointer: EventPointer | AddressPointer,
): string {
  return "id" in pointer
    ? `id:${pointer.id}`
    : `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
}

export function pointerFromCoordinate(
  coordinate: string,
): EventPointer | AddressPointer | null {
  if (coordinate.startsWith("id:")) {
    return { id: coordinate.slice(3) };
  }
  const [kind, pubkey, ...rest] = coordinate.split(":");
  const parsed = Number(kind);
  if (!Number.isInteger(parsed) || !pubkey) return null;
  return { kind: parsed, pubkey, identifier: rest.join(":") };
}

/**
 * Record a successful run.
 *
 * Called only after verification succeeds, so the launcher can never list a
 * napplet that failed its signature or hash checks.
 */
export async function recordNappletRun(input: {
  pointer: EventPointer | AddressPointer;
  kind: number;
  pubkey: string;
  identifier: string;
  title: string;
  description?: string;
}): Promise<void> {
  const coordinate = nappletCoordinate(input.pointer);
  try {
    const existing = await db.napplets.get(coordinate);
    await db.napplets.put({
      coordinate,
      kind: input.kind,
      pubkey: input.pubkey,
      identifier: input.identifier,
      // Titles come from the manifest and can change between versions.
      title: input.title,
      description: input.description,
      lastRunAt: Date.now(),
      runCount: (existing?.runCount ?? 0) + 1,
      pinned: existing?.pinned ?? 0,
    });
  } catch (error) {
    // The launcher is a convenience; never let it break a working napplet.
    console.warn("[napplet] could not record run", error);
  }
}

/** Everything the user has run, pinned first, then most recent. */
export async function listNapplets(): Promise<InstalledNapplet[]> {
  try {
    const all = await db.napplets.toArray();
    return all.sort((a, b) => b.pinned - a.pinned || b.lastRunAt - a.lastRunAt);
  } catch {
    return [];
  }
}

export async function setNappletPinned(
  coordinate: string,
  pinned: boolean,
): Promise<void> {
  await db.napplets.update(coordinate, { pinned: pinned ? 1 : 0 });
}

export async function forgetNapplet(coordinate: string): Promise<void> {
  await db.napplets.delete(coordinate);
}

export type { InstalledNapplet };
