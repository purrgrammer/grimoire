/**
 * Hook that keeps the enforced blocked-relay set in sync with the active
 * account's NIP-51 kind-10006 list. Use once at app root.
 *
 * Nothing here gates startup: the set is empty until the list arrives, so relays
 * connect normally and any that turn out to be blocked are pruned when it lands.
 */

import { useEffect } from "react";
import { startBlockedRelaysSync } from "@/services/blocked-relays-sync";

export function useBlockedRelaysSync() {
  useEffect(() => {
    const subscription = startBlockedRelaysSync();
    return () => subscription.unsubscribe();
  }, []);
}
