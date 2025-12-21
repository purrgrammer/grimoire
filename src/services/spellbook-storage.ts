import db, { LocalSpellbook } from "./db";
import { SpellbookEvent } from "@/types/spell";

/**
 * Find existing spellbook by slug and pubkey
 */
async function findExistingSpellbook(
  slug: string,
  pubkey?: string,
): Promise<LocalSpellbook | undefined> {
  if (!pubkey) {
    // For local-only spellbooks, match by slug
    const spellbooks = await db.spellbooks.where("slug").equals(slug).toArray();
    return spellbooks.find((s) => !s.event?.pubkey);
  }

  // For published spellbooks, match by slug AND pubkey
  const spellbooks = await db.spellbooks.where("slug").equals(slug).toArray();
  return spellbooks.find((s) => s.event?.pubkey === pubkey);
}

/**
 * Save a spellbook to local storage
 * If a spellbook with the same slug and pubkey exists, it will be updated
 */
export async function saveSpellbook(
  spellbook: Omit<LocalSpellbook, "id" | "createdAt"> & { id?: string },
): Promise<LocalSpellbook> {
  // Check for existing spellbook
  const pubkey = spellbook.event?.pubkey;
  const existing = await findExistingSpellbook(spellbook.slug, pubkey);

  let id: string;
  let createdAt: number;

  if (existing) {
    // Update existing spellbook
    id = existing.id;
    createdAt = existing.createdAt;
  } else if (spellbook.id) {
    // Use provided ID (for updates via dialog)
    id = spellbook.id;
    createdAt = Date.now();
  } else {
    // Create new spellbook
    id = spellbook.eventId || crypto.randomUUID();
    createdAt = Date.now();
  }

  const localSpellbook: LocalSpellbook = {
    id,
    createdAt,
    ...spellbook,
  };

  await db.spellbooks.put(localSpellbook);
  return localSpellbook;
}

/**
 * Get a spellbook by ID
 */
export async function getSpellbook(id: string): Promise<LocalSpellbook | undefined> {
  return db.spellbooks.get(id);
}

/**
 * Get all local spellbooks
 */
export async function getAllSpellbooks(): Promise<LocalSpellbook[]> {
  return db.spellbooks.orderBy("createdAt").reverse().toArray();
}

/**
 * Soft-delete a spellbook
 */
export async function deleteSpellbook(id: string): Promise<void> {
  await db.spellbooks.update(id, {
    deletedAt: Date.now(),
  });
}

/**
 * Mark a spellbook as published
 */
export async function markSpellbookPublished(
  localId: string,
  event: SpellbookEvent,
): Promise<void> {
  await db.spellbooks.update(localId, {
    isPublished: true,
    eventId: event.id,
    event,
  });
}
