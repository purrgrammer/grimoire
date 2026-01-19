/**
 * Hook to check if a user is a Grimoire supporter
 */

import { use$ } from "applesauce-react/hooks";
import { supporters$ } from "@/services/supporters";

/**
 * Check if a pubkey belongs to a Grimoire supporter
 * @param pubkey - User's hex public key
 * @returns true if user has zapped Grimoire
 */
export function useIsSupporter(pubkey: string | undefined): boolean {
  const supporters = use$(supporters$);

  if (!pubkey) return false;
  return supporters.has(pubkey);
}
