import { useMemo, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { of } from "rxjs";
import db from "@/services/db";
import { decodeSpell } from "@/lib/spell-conversion";
import type { SpellEvent, ParsedSpell } from "@/types/spell";
import { useStableValue } from "./useStable";
import { createTimelineLoader } from "@/services/loaders";
import pool from "@/services/relay-pool";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

export interface ParameterizedSpell {
  /** Unique identifier (local ID or event ID) */
  id: string;

  /** Spell name */
  name?: string;

  /** Local alias (only for local spells) */
  alias?: string;

  /** REQ command */
  command: string;

  /** Description */
  description?: string;

  /** Parameter type */
  parameterType: "$pubkey" | "$event" | "$relay";

  /** Default parameter values */
  parameterDefault?: string[];

  /** Whether this spell is published to Nostr */
  isPublished: boolean;

  /** Nostr event ID if published */
  eventId?: string;

  /** Full event for reference */
  event?: SpellEvent;

  /** Parsed spell data */
  parsed?: ParsedSpell;

  /** Creation timestamp */
  createdAt: number;

  /** Source of the spell (local db vs network) */
  source: "local" | "network";
}

export interface UseParameterizedSpellsOptions {
  /** Filter by parameter type */
  type?: "$pubkey" | "$event" | "$relay";

  /** Filter by author pubkey (for network spells only) */
  author?: string;

  /** Relay URLs to query network spells from */
  relays?: string[];

  /** Include network spells (default: true) */
  includeNetwork?: boolean;
}

/**
 * Hook for querying parameterized spells (lenses) by type
 * Queries both local database and network events
 *
 * @param options - Query options
 * @returns Object containing spells array and loading state
 */
export function useParameterizedSpells(
  options: UseParameterizedSpellsOptions = {},
): {
  spells: ParameterizedSpell[];
  loading: boolean;
} {
  const { type, author, relays = [], includeNetwork = true } = options;

  const eventStore = useEventStore();
  const [networkLoading, setNetworkLoading] = useState(false);

  // Stabilize options to prevent unnecessary re-renders
  const stableType = useStableValue(type);
  const stableAuthor = useStableValue(author);
  const stableRelays = useStableValue(relays);

  // Query local spells with parameterType or convertible spells
  const localSpells = useLiveQuery(async () => {
    // For $pubkey type, also include non-parameterized spells with $me or $contacts
    if (stableType === "$pubkey") {
      // Get all spells (parameterized and non-parameterized)
      const allSpells = await db.spells.toArray();

      return allSpells.filter((spell) => {
        // Skip soft-deleted
        if (spell.deletedAt) return false;

        // Include explicitly parameterized $pubkey spells
        if (spell.parameterType === "$pubkey") return true;

        // Include spells with $me or $contacts that could be parameterized
        if (!spell.parameterType) {
          const cmd = spell.command.toLowerCase();
          // Check if command uses ONLY $me or ONLY $contacts (not both, not mixed with other pubkeys)
          const hasMeOrContacts =
            cmd.includes("$me") || cmd.includes("$contacts");
          if (!hasMeOrContacts) return false;

          // Make sure it doesn't use multiple different variables
          const hasBothMeAndContacts =
            cmd.includes("$me") && cmd.includes("$contacts");
          if (hasBothMeAndContacts) return false; // Can't have both

          // Check if it has hex pubkeys mixed with $me/$contacts
          // This is a rough check - looking for hex strings in -a or #p tags
          const hasHexPubkey = /(?:-a|#p)\s+[a-f0-9]{64}/.test(cmd);
          if (hasHexPubkey) return false; // Mixed pubkeys, not eligible

          return true;
        }

        return false;
      });
    }

    // For other types or no type filter, use the original indexed query
    let query = db.spells.where("parameterType").notEqual(undefined as any);

    // Filter by type if specified
    if (stableType) {
      query = db.spells.where("parameterType").equals(stableType);
    }

    const results = await query.toArray();

    // Filter out soft-deleted spells
    return results.filter((s) => !s.deletedAt);
  }, [stableType]);

  // Load network spells if enabled
  useEffect(() => {
    if (!includeNetwork || relays.length === 0) return;

    const filter: any = { kinds: [777] };

    // Add author filter if specified
    if (stableAuthor) {
      filter.authors = [stableAuthor];
    }

    // For $pubkey type, load all spells (will filter in merge logic)
    // For other types, filter by parameter tag
    if (stableType && stableType !== "$pubkey") {
      filter["#l"] = [stableType];
    }

    const loader = createTimelineLoader(
      pool,
      [...stableRelays, ...AGGREGATOR_RELAYS],
      filter,
      { eventStore },
    );

    setNetworkLoading(true);

    const subscription = loader().subscribe({
      error: (err: Error) => {
        console.error("Network spells loading error:", err);
        setNetworkLoading(false);
      },
      complete: () => {
        setNetworkLoading(false);
      },
    });

    return () => subscription.unsubscribe();
  }, [includeNetwork, stableRelays, stableAuthor, stableType, eventStore]);

  // Watch event store for matching network spells
  const networkEvents = use$(() => {
    if (!includeNetwork) return of([]);

    const filter: any = { kinds: [777] };

    if (stableAuthor) {
      filter.authors = [stableAuthor];
    }

    // For $pubkey type, load all spells (will filter in merge logic)
    // For other types, filter by parameter tag
    if (stableType && stableType !== "$pubkey") {
      filter["#l"] = [stableType];
    }

    return eventStore.timeline(filter, false);
  }, [includeNetwork, stableAuthor, stableType]);

  // Merge local and network spells
  const spells = useMemo(() => {
    const spellsMap = new Map<string, ParameterizedSpell>();

    // Add local spells
    for (const localSpell of localSpells || []) {
      // Handle explicitly parameterized spells
      if (localSpell.parameterType) {
        // Skip if type filter doesn't match
        if (stableType && localSpell.parameterType !== stableType) continue;

        spellsMap.set(localSpell.id, {
          id: localSpell.id,
          name: localSpell.name,
          alias: localSpell.alias,
          command: localSpell.command,
          description: localSpell.description,
          parameterType: localSpell.parameterType,
          parameterDefault: localSpell.parameterDefault,
          isPublished: localSpell.isPublished,
          eventId: localSpell.eventId,
          event: localSpell.event,
          createdAt: localSpell.createdAt,
          source: "local" as const,
        });
        continue;
      }

      // Handle non-parameterized spells with $me or $contacts (treat as $pubkey)
      if (stableType === "$pubkey") {
        const cmd = localSpell.command.toLowerCase();
        if (cmd.includes("$me") || cmd.includes("$contacts")) {
          // Detect default value from command
          const defaultValue = cmd.includes("$me")
            ? ["$me"]
            : cmd.includes("$contacts")
              ? ["$contacts"]
              : undefined;

          spellsMap.set(localSpell.id, {
            id: localSpell.id,
            name: localSpell.name,
            alias: localSpell.alias,
            command: localSpell.command,
            description: localSpell.description,
            parameterType: "$pubkey" as const,
            parameterDefault: defaultValue,
            isPublished: localSpell.isPublished,
            eventId: localSpell.eventId,
            event: localSpell.event,
            createdAt: localSpell.createdAt,
            source: "local" as const,
          });
        }
      }
    }

    // Add network spells (skip if already in local)
    for (const event of networkEvents || []) {
      // Skip if already have this spell locally
      if (spellsMap.has(event.id)) continue;

      try {
        const parsed = decodeSpell(event as SpellEvent);

        // Skip if author filter doesn't match
        if (stableAuthor && event.pubkey !== stableAuthor) continue;

        // Handle explicitly parameterized spells
        if (parsed.parameter) {
          // Skip if type filter doesn't match
          if (stableType && parsed.parameter.type !== stableType) continue;

          spellsMap.set(event.id, {
            id: event.id,
            name: parsed.name,
            command: parsed.command,
            description: parsed.description,
            parameterType: parsed.parameter.type,
            parameterDefault: parsed.parameter.default,
            isPublished: true,
            eventId: event.id,
            event: event as SpellEvent,
            parsed,
            createdAt: event.created_at * 1000,
            source: "network" as const,
          });
          continue;
        }

        // Handle non-parameterized spells with $me or $contacts (treat as $pubkey)
        if (stableType === "$pubkey") {
          const cmd = parsed.command.toLowerCase();
          if (cmd.includes("$me") || cmd.includes("$contacts")) {
            // Detect default value from command
            const defaultValue = cmd.includes("$me")
              ? ["$me"]
              : cmd.includes("$contacts")
                ? ["$contacts"]
                : undefined;

            spellsMap.set(event.id, {
              id: event.id,
              name: parsed.name,
              command: parsed.command,
              description: parsed.description,
              parameterType: "$pubkey" as const,
              parameterDefault: defaultValue,
              isPublished: true,
              eventId: event.id,
              event: event as SpellEvent,
              parsed,
              createdAt: event.created_at * 1000,
              source: "network" as const,
            });
          }
        }
      } catch (e) {
        console.warn("Failed to decode network spell", event.id, e);
      }
    }

    // Convert to array and sort by creation date (newest first)
    return Array.from(spellsMap.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }, [localSpells, networkEvents, stableType, stableAuthor]);

  const loading = localSpells === undefined || networkLoading;

  return {
    spells,
    loading,
  };
}

/**
 * Convenience hook for querying user's own parameterized spells
 *
 * @param pubkey - User's pubkey
 * @param type - Optional parameter type filter
 * @param relays - Relay URLs to query from
 * @returns Object containing spells array and loading state
 */
export function useUserParameterizedSpells(
  pubkey: string | undefined,
  type?: "$pubkey" | "$event" | "$relay",
  relays: string[] = [],
): {
  spells: ParameterizedSpell[];
  loading: boolean;
} {
  return useParameterizedSpells({
    type,
    author: pubkey,
    relays,
    includeNetwork: !!pubkey && relays.length > 0,
  });
}
