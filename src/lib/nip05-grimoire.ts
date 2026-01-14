import { nip19 } from "nostr-tools";

/**
 * Hardcoded test pubkey for grimoire.app premium treatment
 * npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg
 */
const PREMIUM_TEST_PUBKEY = (() => {
  try {
    const decoded = nip19.decode(
      "npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg",
    );
    return decoded.type === "npub" ? decoded.data : null;
  } catch {
    return null;
  }
})();

/**
 * Check if a pubkey should receive grimoire.app premium visual treatment
 * Currently hardcoded for testing, will be replaced with NIP-05 check
 */
export function isGrimoirePremium(pubkey: string): boolean {
  return pubkey === PREMIUM_TEST_PUBKEY;
}

/**
 * Check if a NIP-05 identifier is a grimoire.app address
 * Future: Will check for @grimoire.app suffix
 */
export function isGrimoireNip05(nip05?: string): boolean {
  if (!nip05) return false;
  return nip05.endsWith("@grimoire.app");
}

/**
 * Extract username from grimoire.app NIP-05
 * Returns null if not a grimoire.app address
 */
export function getGrimoireUsername(nip05: string): string | null {
  if (!isGrimoireNip05(nip05)) return null;
  return nip05.split("@")[0];
}
