import { EVENT_KINDS } from "@/constants/kinds";

/**
 * Get all event kinds defined in a specific NIP
 */
export function getKindsForNip(nipId: string): number[] {
  const kinds: number[] = [];

  for (const [kindKey, kindInfo] of Object.entries(EVENT_KINDS)) {
    if (kindInfo.nip === nipId) {
      const kindNum =
        typeof kindInfo.kind === "number" ? kindInfo.kind : parseInt(kindKey);
      kinds.push(kindNum);
    }
  }

  return kinds.sort((a, b) => a - b);
}
