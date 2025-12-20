import db, { LocalSpell } from "./db";
import { SpellEvent } from "@/types/spell";

/**
 * Save a spell to local storage
 * @param spell - Spell data to save
 * @returns The saved spell
 * @throws Error if alias is already in use by another spell
 */
export async function saveSpell(
  spell: Omit<LocalSpell, "id" | "createdAt">,
): Promise<LocalSpell> {
  const id = spell.eventId || crypto.randomUUID();
  const createdAt = Date.now();

  // Validate alias uniqueness if provided
  if (spell.alias) {
    const existingWithAlias = await getSpellByAlias(spell.alias);
    if (existingWithAlias && existingWithAlias.id !== id) {
      throw new Error(
        `Alias "${spell.alias}" is already in use by another spell`,
      );
    }
  }

  const localSpell: LocalSpell = {
    id,
    createdAt,
    ...spell,
  };

  await db.spells.put(localSpell);
  return localSpell;
}

/**
 * Get a spell by ID
 * @param id - Spell ID
 * @returns The spell or undefined if not found
 */
export async function getSpell(id: string): Promise<LocalSpell | undefined> {
  return db.spells.get(id);
}

/**
 * Get all spells, sorted by creation date (newest first)
 * @returns Array of spells
 */
export async function getAllSpells(): Promise<LocalSpell[]> {
  return db.spells.orderBy("createdAt").reverse().toArray();
}

/**
 * Update an existing spell
 * @param id - Spell ID
 * @param updates - Fields to update
 */
export async function updateSpell(
  id: string,
  updates: Partial<Omit<LocalSpell, "id" | "createdAt">>,
): Promise<void> {
  await db.spells.update(id, updates);
}

/**
 * Soft-delete a spell (mark as deleted)
 * @param id - Spell ID
 */
export async function deleteSpell(id: string): Promise<void> {
  await db.spells.update(id, {
    deletedAt: Date.now(),
  });
}

/**
 * Hard-delete a spell (permanently remove from DB)
 * @param id - Spell ID
 */
export async function hardDeleteSpell(id: string): Promise<void> {
  await db.spells.delete(id);
}

/**
 * Mark a spell as published and associate with event ID
 * @param localId - Local spell ID
 * @param event - Published spell event
 */
export async function markSpellPublished(
  localId: string,
  event: SpellEvent,
): Promise<void> {
  await db.spells.update(localId, {
    isPublished: true,
    eventId: event.id,
    event,
  });
}

/**
 * Get spell alias by event ID
 * @param eventId - Nostr event ID
 * @returns Local alias or undefined
 */
export async function getSpellAliasByEventId(
  eventId: string,
): Promise<string | undefined> {
  const spell = await db.spells.where("eventId").equals(eventId).first();
  return spell?.alias;
}

/**
 * Get spell by alias
 * @param alias - Spell alias
 * @returns The spell or undefined if not found
 */
export async function getSpellByAlias(
  alias: string,
): Promise<LocalSpell | undefined> {
  return db.spells.where("alias").equals(alias).first();
}
