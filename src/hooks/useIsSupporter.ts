/**
 * Hook to check if a user is a Grimoire supporter
 */

import { use$ } from "applesauce-react/hooks";
import { useState, useEffect } from "react";
import supportersService from "@/services/supporters";

/**
 * Check if a pubkey belongs to a Grimoire supporter
 * @param pubkey - User's hex public key
 * @returns Object with supporter status and premium status
 */
export function useIsSupporter(pubkey: string | undefined): {
  isSupporter: boolean;
  isPremiumSupporter: boolean;
} {
  const supporters = use$(supportersService.supporters$);
  const [isPremium, setIsPremium] = useState(false);

  // Check premium status async
  useEffect(() => {
    if (!pubkey || !supporters.has(pubkey)) {
      setIsPremium(false);
      return;
    }

    supportersService.isPremiumSupporter(pubkey).then(setIsPremium);
  }, [pubkey, supporters]);

  if (!pubkey) {
    return { isSupporter: false, isPremiumSupporter: false };
  }

  return {
    isSupporter: supporters.has(pubkey),
    isPremiumSupporter: isPremium,
  };
}
