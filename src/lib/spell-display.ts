import { decodeSpell } from "./spell-conversion";
import { parseReqCommand } from "./req-parser";

/**
 * Extract kind numbers from a spell for display purposes
 * Handles both published spell events and local command-only spells
 * Returns up to 3 kinds for display in spell tabs
 */
export function extractSpellKinds(spell: {
  command: string;
  event?: any;
}): number[] {
  try {
    // Try decoding from published event first
    if (spell.event) {
      const decoded = decodeSpell(spell.event);
      return decoded.filter.kinds?.slice(0, 3) || [];
    }

    // Parse from command string for local spells
    const commandWithoutPrefix = spell.command
      .replace(/^\s*(req|count)\s+/i, "")
      .trim();
    const tokens = commandWithoutPrefix.split(/\s+/);
    const parsed = parseReqCommand(tokens);
    return parsed.filter.kinds?.slice(0, 3) || [];
  } catch {
    // Return empty array on parsing failure
    return [];
  }
}
