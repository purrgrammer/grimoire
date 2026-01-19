/**
 * Hook to check if a user is a Grimoire supporter
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useState, useEffect } from "react";
import supportersService from "@/services/supporters";
import db from "@/services/db";

/**
 * Check if a pubkey belongs to a Grimoire supporter
 * @param pubkey - User's hex public key
 * @returns Object with supporter status and premium status
 */
export function useIsSupporter(pubkey: string | undefined): {
  isSupporter: boolean;
  isPremiumSupporter: boolean;
} {
  // Get all unique supporter pubkeys reactively from DB
  const supporterPubkeys = useLiveQuery(
    () => db.grimoireZaps.orderBy("senderPubkey").uniqueKeys(),
    [],
  );

  const [isPremium, setIsPremium] = useState(false);

  // Convert to Set for efficient lookup
  const supporters = supporterPubkeys
    ? new Set(supporterPubkeys as string[])
    : new Set<string>();

  // Check premium status async
  useEffect(() => {
    if (!pubkey || !supporters.has(pubkey)) {
      setIsPremium(false);
      return;
    }

    supportersService.isPremiumSupporter(pubkey).then(setIsPremium);
  }, [pubkey, supporters.size]); // Use supporters.size to avoid Set equality issues

  if (!pubkey) {
    return { isSupporter: false, isPremiumSupporter: false };
  }

  return {
    isSupporter: supporters.has(pubkey),
    isPremiumSupporter: isPremium,
  };
}
