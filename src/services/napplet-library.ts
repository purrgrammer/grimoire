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
import type { NostrEvent } from "@/types/nostr";

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
  manifest?: NostrEvent;
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
      manifest: input.manifest ?? existing?.manifest,
      lastRunAt: Date.now(),
      runCount: (existing?.runCount ?? 0) + 1,
      pinned: existing?.pinned ?? 0,
    });
  } catch (error) {
    // The launcher is a convenience; never let it break a working napplet.
    console.warn("[napplet] could not record run", error);
  }
}

/**
 * The last verified manifest for a pointer, if one was cached.
 *
 * Used only when relays do not answer. `resolveNapplet` re-verifies it, so a
 * stale copy is either still valid or rejected — never trusted on account of
 * having been cached.
 */
export async function getCachedManifest(
  pointer: EventPointer | AddressPointer,
): Promise<NostrEvent | undefined> {
  try {
    const row = await db.napplets.get(nappletCoordinate(pointer));
    return row?.manifest;
  } catch {
    return undefined;
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

/** Verified catalog identity for each mounted napplet document. */
const windowCatalog = new Map<string, string>();

export function setWindowCatalogId(windowId: string, catalogId: string): void {
  windowCatalog.set(windowId, catalogId);
}

export function getWindowCatalogId(windowId: string): string | undefined {
  return windowCatalog.get(windowId);
}

export function clearWindowCatalogId(windowId: string): void {
  windowCatalog.delete(windowId);
}

/** Publisher-safe ID without importing the runtime into the command registry. */
export function installedNappletCatalogId(row: {
  coordinate: string;
  manifest?: NostrEvent;
}): string | undefined {
  const event = row.manifest;
  if (event?.kind === 5129) return `nip5d:5129:${event.id}`;
  if (event?.kind === 15129) return `nip5d:15129:${event.pubkey}`;
  if (event?.kind === 35129) {
    const identifier = event.tags.find((tag) => tag[0] === "d")?.[1];
    if (identifier) return `nip5d:35129:${event.pubkey}:${identifier}`;
  }
  const pointer = pointerFromCoordinate(row.coordinate);
  if (!pointer) return undefined;
  if ("id" in pointer) return `nip5d:5129:${pointer.id}`;
  return pointer.kind === 15129
    ? `nip5d:15129:${pointer.pubkey}`
    : `nip5d:${row.coordinate}`;
}
