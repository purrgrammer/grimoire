import { useMemo } from "react";
import { decodeSpell } from "@/lib/spell-conversion";
import { parseReqCommand } from "@/lib/req-parser";
import type { ParsedSpell } from "@/types/spell";

interface SpellDefinition {
  id: string;
  name?: string;
  command: string;
  parameterType?: "$pubkey" | "$event" | "$relay";
  parameterDefault?: string[];
  event?: any;
}

/**
 * Parse a spell definition into a usable format
 * Handles both published spell events and local command-only spells
 * Returns null if spell cannot be parsed or target is missing
 */
export function useParseSpell(
  spell: SpellDefinition,
  targetKey: string, // For logging and cache invalidation
  spellId?: string, // Optional ID for better logging
): ParsedSpell | null {
  return useMemo(() => {
    if (!targetKey) {
      console.log(
        `[Spell:${spell.name || spellId || "unknown"}] No target provided`,
      );
      return null;
    }

    try {
      console.log(
        `[Spell:${spell.name || spellId || "unknown"}] Parsing spell:`,
        {
          hasEvent: !!spell.event,
          command: spell.command,
          parameterType: spell.parameterType,
        },
      );

      // If we have a published event, decode it
      if (spell.event) {
        const decoded = decodeSpell(spell.event);
        console.log(
          `[Spell:${spell.name || spellId || "unknown"}] Decoded from event:`,
          {
            filter: decoded.filter,
            relays: decoded.relays,
            parameter: decoded.parameter,
          },
        );
        return decoded;
      }

      // For local spells, parse the command directly
      console.log(
        `[Spell:${spell.name || spellId || "unknown"}] Parsing local spell command`,
      );
      const commandWithoutPrefix = spell.command
        .replace(/^\s*(req|count)\s+/i, "")
        .trim();
      const tokens = commandWithoutPrefix.split(/\s+/);
      const commandParsed = parseReqCommand(tokens);

      // Create a ParsedSpell-like object for local spells
      const localParsed = {
        command: spell.command,
        filter: commandParsed.filter,
        relays: commandParsed.relays,
        closeOnEose: commandParsed.closeOnEose,
        parameter: spell.parameterType
          ? {
              type: spell.parameterType,
              default: spell.parameterDefault,
            }
          : undefined,
      } as ParsedSpell;

      console.log(
        `[Spell:${spell.name || spellId || "unknown"}] Parsed local spell:`,
        {
          filter: localParsed.filter,
          relays: localParsed.relays,
          parameter: localParsed.parameter,
        },
      );

      return localParsed;
    } catch (error) {
      console.error(
        `[Spell:${spell.name || spellId || "unknown"}] Failed to parse spell:`,
        error,
      );
      return null;
    }
  }, [spell, targetKey, spellId]);
}
